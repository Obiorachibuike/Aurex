/**
 * Shared cookie attributes: httpOnly always; Secure in production; SameSite=Lax.
 * EMBEDDED_PREVIEW=true (development previews shown inside a third-party iframe) switches to
 * SameSite=None; Secure so the session survives the iframe. Never set it in production.
 */
export function cookieOptions(days: number) {
  const embedded = process.env.EMBEDDED_PREVIEW === "true" && process.env.VERCEL_ENV !== "production";
  const secure = embedded || (process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true");
  return { httpOnly: true, secure, sameSite: embedded ? ("none" as const) : ("lax" as const), path: "/", maxAge: days * 86_400 };
}
