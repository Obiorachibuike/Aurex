import { createHash } from "node:crypto";
import { env } from "./env";
import { AppError } from "./errors";

const MAX_BYTES = 5 * 1024 * 1024;

/** Detects the real file type from magic bytes — the browser-supplied MIME type is not trusted. */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export const cloudinaryConfigured = () => !!(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

export function signCloudinary(params: Record<string, string>, secret: string): string {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha1").update(toSign + secret).digest("hex");
}

/** Validates and uploads a product image to Cloudinary using a server-side signed request. */
export async function uploadProductImage(file: File): Promise<{ url: string; publicId: string }> {
  if (!cloudinaryConfigured()) throw new AppError("Image uploads are not configured. Add the Cloudinary keys, or paste an image URL instead.", "UPLOADS_NOT_CONFIGURED", 503);
  if (file.size === 0) throw new AppError("The file is empty.", "INVALID_FILE", 400);
  if (file.size > MAX_BYTES) throw new AppError("Images must be 5 MB or smaller.", "FILE_TOO_LARGE", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new AppError("Only JPEG, PNG or WebP images can be uploaded.", "INVALID_FILE", 400);

  const params = { folder: "aurex/products", timestamp: String(Math.floor(Date.now() / 1000)) };
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), "upload");
  form.append("api_key", env.cloudinary.apiKey);
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append("signature", signCloudinary(params, env.cloudinary.apiSecret));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/image/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  const body = (await res.json().catch(() => null)) as { secure_url?: string; public_id?: string; error?: { message?: string } } | null;
  if (!res.ok || !body?.secure_url || !body.public_id) throw new AppError(`Upload failed: ${body?.error?.message ?? res.statusText}`, "UPLOAD_FAILED", 502);
  return { url: body.secure_url, publicId: body.public_id };
}
