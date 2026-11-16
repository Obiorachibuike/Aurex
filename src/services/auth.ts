import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { authTokens, customerProfiles, permissions, rolePermissions, roles, userSessions, users } from "@/db/schema";
import type { PermissionKey, RoleKey } from "@/lib/auth/permissions";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { queueNotification } from "./notifications";

export const SESSION_TTL_DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  roleKey: RoleKey;
  roleName: string;
  isStaff: boolean;
  permissions: PermissionKey[];
  emailVerified: boolean;
  wholesaleStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  /** True only for approved wholesale accounts — the single switch for wholesale pricing. */
  wholesaleApproved: boolean;
  groupId: string | null;
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function roleId(key: RoleKey, conn: DbOrTx = db): Promise<string> {
  const [r] = await conn.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
  if (!r) throw new Error(`Role "${key}" is missing — run "npm run db:seed".`);
  return r.id;
}

export async function createUser(
  input: { name: string; email: string; password: string; phone?: string | null; role?: RoleKey; emailVerified?: boolean },
  conn: DbOrTx = db,
) {
  const email = normalizeEmail(input.email);
  const [existing] = await conn.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing) throw new AppError("An account with this email already exists.", "EMAIL_TAKEN", 409);
  const [user] = await conn
    .insert(users)
    .values({
      name: input.name.trim(),
      email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password),
      roleId: await roleId(input.role ?? "customer", conn),
      emailVerifiedAt: input.emailVerified ? new Date() : null,
    })
    .returning();
  await conn.insert(customerProfiles).values({ userId: user!.id }).onConflictDoNothing();
  return user!;
}

async function issueToken(userId: string, type: "VERIFY_EMAIL" | "RESET_PASSWORD", ttlMinutes: number, conn: DbOrTx = db): Promise<string> {
  const token = randomToken();
  await conn.insert(authTokens).values({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) });
  return token;
}

export async function registerCustomer(input: { name: string; email: string; password: string; phone?: string | null }) {
  return db.transaction(async (tx) => {
    const user = await createUser(input, tx);
    const token = await issueToken(user.id, "VERIFY_EMAIL", 60 * 24 * 3, tx);
    await queueNotification({ template: "welcome_verify", recipient: user.email, userId: user.id, payload: { name: user.name, url: `${env.appUrl}/verify-email?token=${token}` } }, tx);
    return user;
  });
}

export async function resendVerification(userId: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.emailVerifiedAt) return;
  const token = await issueToken(user.id, "VERIFY_EMAIL", 60 * 24 * 3);
  await queueNotification({ template: "welcome_verify", recipient: user.email, userId: user.id, payload: { name: user.name, url: `${env.appUrl}/verify-email?token=${token}` } });
}

async function consumeToken(token: string, type: "VERIFY_EMAIL" | "RESET_PASSWORD", conn: DbOrTx): Promise<string | null> {
  const [row] = await conn
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.type, type), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning({ userId: authTokens.userId });
  return row?.userId ?? null;
}

export async function verifyEmail(token: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const userId = await consumeToken(token, "VERIFY_EMAIL", tx);
    if (!userId) return false;
    await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
    return true;
  });
}

/** Always resolves without revealing whether the email exists. */
export async function requestPasswordReset(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  const [user] = await db.select().from(users).where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt))).limit(1);
  if (!user || user.isSuspended) return;
  const token = await issueToken(user.id, "RESET_PASSWORD", 60);
  await queueNotification({ template: "password_reset", recipient: user.email, userId: user.id, payload: { name: user.name, url: `${env.appUrl}/reset-password?token=${token}` } });
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const userId = await consumeToken(token, "RESET_PASSWORD", tx);
    if (!userId) return false;
    // Possession of the emailed link also proves control of the mailbox.
    await tx.update(users).set({ passwordHash: await hashPassword(newPassword), emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, userId));
    await tx.delete(userSessions).where(eq(userSessions.userId, userId));
    return true;
  });
}

export async function changePassword(userId: string, current: string, next: string, keepSessionToken?: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw new AppError("Your current password is incorrect.", "INVALID_CREDENTIALS", 400);
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  const keep = keepSessionToken ? sha256(keepSessionToken) : "";
  await db.delete(userSessions).where(and(eq(userSessions.userId, userId), sql`${userSessions.tokenHash} <> ${keep}`));
}

// Pre-computed hash so unknown emails take as long as wrong passwords (prevents user enumeration by timing).
let dummyHash: Promise<string> | null = null;

export async function authenticate(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const [user] = await db.select().from(users).where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt))).limit(1);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await (dummyHash ??= hashPassword("aurex-dummy-password"))));
  if (!user || !ok) throw new AppError("Incorrect email or password.", "INVALID_CREDENTIALS", 401);
  if (user.isSuspended) throw new AppError("This account has been suspended. Please contact support.", "SUSPENDED", 403);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return user;
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(userSessions).values({ userId, tokenHash: sha256(token), expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.tokenHash, sha256(token)));
}

export async function getSessionUser(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({ user: users, role: roles, profile: customerProfiles })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(customerProfiles, eq(customerProfiles.userId, users.id))
    .where(and(eq(userSessions.tokenHash, sha256(token)), gt(userSessions.expiresAt, new Date()), isNull(users.deletedAt), eq(users.isSuspended, false)))
    .limit(1);
  if (!row) return null;
  return buildSessionUser(row.user, row.role, row.profile);
}

export async function getUserContext(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ user: users, role: roles, profile: customerProfiles })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(customerProfiles, eq(customerProfiles.userId, users.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return row ? buildSessionUser(row.user, row.role, row.profile) : null;
}

async function buildSessionUser(user: typeof users.$inferSelect, role: typeof roles.$inferSelect, profile: typeof customerProfiles.$inferSelect | null): Promise<SessionUser> {
  const perms = role.isStaff
    ? await db.select({ key: permissions.key }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(eq(rolePermissions.roleId, role.id))
    : [];
  const wholesaleStatus = profile?.wholesaleStatus ?? "NONE";
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    roleKey: role.key as RoleKey,
    roleName: role.name,
    isStaff: role.isStaff,
    permissions: perms.map((p) => p.key as PermissionKey),
    emailVerified: !!user.emailVerifiedAt,
    wholesaleStatus,
    wholesaleApproved: wholesaleStatus === "APPROVED",
    groupId: wholesaleStatus === "APPROVED" ? (profile?.groupId ?? null) : null,
  };
}

export function hasPermission(user: SessionUser | null | undefined, permission: PermissionKey): boolean {
  return !!user && user.isStaff && user.permissions.includes(permission);
}

export async function setUserRole(userId: string, role: RoleKey, conn: DbOrTx = db): Promise<void> {
  await conn.update(users).set({ roleId: await roleId(role, conn) }).where(eq(users.id, userId));
}
