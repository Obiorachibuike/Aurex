import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { reportError } from "./monitoring";
import { parseMoney } from "./utils";
import { fieldErrors, firstError } from "./validation";

export type ActionState<T = unknown> = { ok: boolean; message?: string; error?: string; fieldErrors?: Record<string, string>; data?: T } | null;

/** Wraps a server action body: customer-safe errors are returned, anything else is reported and masked. */
export async function runAction<T = unknown>(fn: () => Promise<{ message?: string; data?: T } | void>): Promise<NonNullable<ActionState<T>>> {
  try {
    const res = await fn();
    return { ok: true, message: res?.message, data: res?.data };
  } catch (e) {
    unstable_rethrow(e); // redirect() / notFound() must propagate
    if (e instanceof ZodError) return { ok: false, error: firstError(e), fieldErrors: fieldErrors(e) };
    if (e instanceof AppError) return { ok: false, error: e.message };
    reportError(e, { where: "server-action" });
    return { ok: false, error: "Something went wrong on our side. Please try again." };
  }
}

/* FormData readers */
export const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (fd: FormData, key: string): string | undefined => str(fd, key) || undefined;
export const bool = (fd: FormData, key: string): boolean => ["on", "true", "1", "yes"].includes(str(fd, key));
export const int = (fd: FormData, key: string, fallback = NaN): number => {
  const s = str(fd, key);
  return /^-?\d+$/.test(s) ? Number(s) : fallback;
};
export const optInt = (fd: FormData, key: string): number | null => {
  const s = str(fd, key);
  return /^-?\d+$/.test(s) ? Number(s) : null;
};
/** Naira typed by a human → kobo. Empty → null. Invalid → NaN so validation rejects it. */
export const kobo = (fd: FormData, key: string): number | null => {
  const s = str(fd, key);
  if (!s) return null;
  return parseMoney(s) ?? NaN;
};
export const optDate = (fd: FormData, key: string): Date | null => {
  const s = str(fd, key);
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00+01:00` : s);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const uuidOrNull = (fd: FormData, key: string): string | null => {
  const s = str(fd, key);
  return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
};
