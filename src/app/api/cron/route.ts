import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { reportError } from "@/lib/monitoring";
import { dispatchQueuedNotifications } from "@/services/notifications";
import { reconcilePayments } from "@/services/payments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background worker, triggered by Vercel Cron (see vercel.json) or any scheduler:
 *   GET /api/cron   with   Authorization: Bearer $CRON_SECRET
 * – reconciles pending payments with the gateways and releases expired stock reservations
 * – delivers queued emails / WhatsApp messages
 * – prunes expired sessions, tokens and rate-limit counters
 */
export async function GET(req: Request) {
  const secret = env.cronSecret;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(given, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const payments = await reconcilePayments();
    const notifications = await dispatchQueuedNotifications(50);
    await db.execute(sql`delete from user_sessions where expires_at < now()`);
    await db.execute(sql`delete from auth_tokens where expires_at < now() - interval '7 days'`);
    await db.execute(sql`delete from rate_limits where reset_at < now() - interval '1 hour'`);
    return NextResponse.json({ ok: true, payments, notifications });
  } catch (e) {
    reportError(e, { where: "cron" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
