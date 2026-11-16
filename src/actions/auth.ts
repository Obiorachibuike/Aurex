"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runAction, str, type ActionState } from "@/lib/action";
import { endSession, getClientIp, requireUserAction, safeNext, SESSION_COOKIE, startSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { normalizeNigerianPhone } from "@/lib/nigeria";
import { enforceRateLimit } from "@/lib/rate-limit";
import { emailSchema, loginSchema, passwordSchema, registerSchema } from "@/lib/validation";
import { adoptGuestCart } from "@/lib/viewer";
import { audit } from "@/services/audit";
import { authenticate, changePassword, getUserContext, registerCustomer, requestPasswordReset, resendVerification, resetPassword } from "@/services/auth";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let target = "/account";
  const res = await runAction(async () => {
    const ip = await getClientIp();
    const input = loginSchema.parse({ email: str(fd, "email"), password: String(fd.get("password") ?? "") });
    await enforceRateLimit(`login:ip:${ip}`, 20, 600);
    await enforceRateLimit(`login:email:${input.email}`, 8, 600, "Too many sign-in attempts for this account. Please wait 10 minutes and try again.");
    const user = await authenticate(input.email, input.password);
    await startSession(user.id);
    await adoptGuestCart(user.id);
    const isStaff = (await getUserContext(user.id))?.isStaff ?? false;
    target = safeNext(str(fd, "next"), isStaff ? "/admin" : "/account");
  });
  if (res.ok) redirect(target);
  return res;
}

export async function registerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let target = "/account?welcome=1";
  const res = await runAction(async () => {
    await enforceRateLimit(`register:${await getClientIp()}`, 6, 3600, "Too many sign-ups from this network. Please try again later.");
    const input = registerSchema.parse({ name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone"), password: String(fd.get("password") ?? "") });
    if (fd.get("terms") !== "on") throw new AppError("Please accept the terms to create an account.");
    const user = await registerCustomer({ name: input.name, email: input.email, password: input.password, phone: input.phone ? normalizeNigerianPhone(input.phone) : null });
    await startSession(user.id);
    await adoptGuestCart(user.id);
    const next = safeNext(str(fd, "next"), "");
    if (next) target = next;
  });
  if (res.ok) redirect(target);
  return res;
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}

export async function forgotPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const email = emailSchema.parse(str(fd, "email"));
    await enforceRateLimit(`forgot:${await getClientIp()}`, 5, 900);
    await enforceRateLimit(`forgot:email:${email}`, 3, 900);
    await requestPasswordReset(email);
    // Same response whether or not the account exists, so emails cannot be enumerated.
    return { message: "If an account exists for that email, a reset link is on its way. It expires in 60 minutes." };
  });
}

export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    await enforceRateLimit(`reset:${await getClientIp()}`, 10, 900);
    const password = passwordSchema.parse(String(fd.get("password") ?? ""));
    if (password !== String(fd.get("confirm") ?? "")) throw new AppError("The two passwords do not match.");
    const ok = await resetPassword(str(fd, "token"), password);
    if (!ok) throw new AppError("This reset link is invalid or has expired. Please request a new one.");
  });
  if (res.ok) redirect("/login?reset=1");
  return res;
}

export async function resendVerificationAction(): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUserAction();
    if (user.emailVerified) return { message: "Your email is already verified." };
    await enforceRateLimit(`verify:${user.id}`, 3, 900, "A verification email was sent recently. Please check your inbox or try again in a few minutes.");
    await resendVerification(user.id);
    return { message: `Verification email sent to ${user.email}.` };
  });
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUserAction();
    await enforceRateLimit(`pwd:${user.id}`, 6, 900);
    const next = passwordSchema.parse(String(fd.get("password") ?? ""));
    if (next !== String(fd.get("confirm") ?? "")) throw new AppError("The two new passwords do not match.");
    await changePassword(user.id, String(fd.get("current") ?? ""), next, (await cookies()).get(SESSION_COOKIE)?.value);
    await audit({ actorId: user.id, action: "auth.password_change", entityType: "user", entityId: user.id, ip: await getClientIp() });
    return { message: "Password updated. Other devices have been signed out." };
  });
}
