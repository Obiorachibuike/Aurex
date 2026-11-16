import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { uploadProductImage } from "@/lib/cloudinary";
import { AppError } from "@/lib/errors";
import { isSameOrigin, jsonError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { audit } from "@/services/audit";

export const maxDuration = 60;

/** Staff-only product image upload. Type and size are validated server-side before Cloudinary sees the file. */
export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req)) return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
    const actor = await requirePermission("products.manage");
    await enforceRateLimit(`upload:${actor.id}`, 60, 600);
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) throw new AppError("Choose an image to upload.");
    const result = await uploadProductImage(file);
    await audit({ actorId: actor.id, action: "image.upload", entityType: "product_image", entityId: result.publicId });
    return NextResponse.json(result);
  } catch (e) {
    return jsonError(e, "admin.upload");
  }
}
