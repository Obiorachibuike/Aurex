import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { reportError } from "./monitoring";
import { firstError } from "./validation";

export function jsonError(e: unknown, where: string): NextResponse {
  if (e instanceof ZodError) return NextResponse.json({ error: firstError(e), code: "VALIDATION" }, { status: 400 });
  if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  reportError(e, { where });
  return NextResponse.json({ error: "Something went wrong on our side. Please try again.", code: "INTERNAL" }, { status: 500 });
}

/**
 * CSRF defence for cookie-authenticated JSON endpoints: a browser always sends Origin on
 * cross-site POSTs, so a mismatch with the Host is rejected. (Server Actions get the same
 * check from Next.js itself; session cookies are also SameSite=Lax.)
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
