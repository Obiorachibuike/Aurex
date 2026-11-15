import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { cookieOptions } from "@/lib/cookies";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { createSession, destroySession, getSessionUser, hasPermission, SESSION_TTL_DAYS, type SessionUser } from "@/services/auth";
import type { PermissionKey } from "./permissions";

export const SESSION_COOKIE = "aurex_session";


export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(token);
});

export async function getClientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function startSession(userId: string): Promise<void> {
  const h = await headers();
  const { token } = await createSession(userId, { ip: await getClientIp(), userAgent: h.get("user-agent") });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_DAYS));
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  jar.delete(SESSION_COOKIE);
}

/** For pages: redirects guests to the login page. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`);
  return user;
}

/** For admin pages: non-staff get a 404 so the admin area is not discoverable. */
export async function requireStaffPage(permission: PermissionKey = "admin.access"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!hasPermission(user, "admin.access") || !hasPermission(user, permission)) notFound();
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requirePermission(permission: PermissionKey): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  if (!hasPermission(user, permission)) throw new ForbiddenError();
  return user;
}

export async function requireUserAction(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Only allows same-site relative redirect targets. */
export function safeNext(next: string | null | undefined, fallback = "/account"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
