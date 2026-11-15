import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { notifications } from "@/db/schema";
import { env } from "@/lib/env";
import { logInfo, reportError } from "@/lib/monitoring";
import { getSetting } from "../settings";
import { renderTemplate, type TemplateKey } from "./templates";

export type QueueInput = {
  template: TemplateKey;
  recipient: string;
  userId?: string | null;
  payload: Record<string, unknown>;
  /** Same key ⇒ the notification is only ever queued once. */
  dedupeKey?: string;
  channel?: "EMAIL" | "WHATSAPP";
};

/** Queues a notification inside the caller's transaction. Delivery happens asynchronously. */
export async function queueNotification(input: QueueInput, conn: DbOrTx = db): Promise<void> {
  if (!input.recipient) return;
  await conn
    .insert(notifications)
    .values({
      template: input.template,
      recipient: input.recipient,
      userId: input.userId ?? null,
      payload: input.payload,
      dedupeKey: input.dedupeKey ?? null,
      channel: input.channel ?? "EMAIL",
    })
    .onConflictDoNothing({ target: notifications.dedupeKey });
}

export interface MessageChannel {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<{ delivered: boolean; detail?: string }>;
}

/** Resend transactional email. Without RESEND_API_KEY messages are logged and marked SKIPPED. */
export const resendChannel: MessageChannel = {
  async send(msg) {
    if (!env.resend.apiKey) {
      logInfo("email.skipped (RESEND_API_KEY not set)", { to: msg.to, subject: msg.subject, preview: msg.text.slice(0, 400) });
      return { delivered: false, detail: "RESEND_API_KEY not configured" };
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resend.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.resend.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { delivered: true };
  },
};

/**
 * WhatsApp Cloud API channel placeholder: the queue already supports channel = WHATSAPP,
 * so adding delivery later only requires implementing this interface.
 */
export const whatsappChannel: MessageChannel = {
  async send() {
    return { delivered: false, detail: "WhatsApp channel not configured" };
  },
};

const MAX_ATTEMPTS = 5;

/** Delivers queued notifications. Safe to run concurrently (rows are claimed with SKIP LOCKED). */
export async function dispatchQueuedNotifications(limit = 25, channels: { EMAIL: MessageChannel; WHATSAPP: MessageChannel } = { EMAIL: resendChannel, WHATSAPP: whatsappChannel }): Promise<{ sent: number; skipped: number; failed: number }> {
  const settings = await getSetting("notifications");
  const stats = { sent: 0, skipped: 0, failed: 0 };
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.status, "QUEUED"), lt(notifications.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(notifications.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const r of rows) await tx.update(notifications).set({ attempts: sql`${notifications.attempts} + 1` }).where(eq(notifications.id, r.id));
    return rows;
  });
  for (const n of claimed) {
    try {
      const rendered = renderTemplate(n.template as TemplateKey, n.payload, settings.templates[n.template]);
      const result = settings.emailEnabled || n.channel !== "EMAIL" ? await channels[n.channel].send({ to: n.recipient, ...rendered }) : { delivered: false, detail: "Email disabled in settings" };
      await db
        .update(notifications)
        .set(result.delivered ? { status: "SENT", sentAt: new Date(), error: null } : { status: "SKIPPED", error: result.detail ?? null })
        .where(eq(notifications.id, n.id));
      if (result.delivered) stats.sent++;
      else stats.skipped++;
    } catch (e) {
      stats.failed++;
      const attempts = n.attempts + 1;
      await db
        .update(notifications)
        .set({ status: attempts >= MAX_ATTEMPTS ? "FAILED" : "QUEUED", error: e instanceof Error ? e.message.slice(0, 500) : "send failed" })
        .where(eq(notifications.id, n.id));
      reportError(e, { scope: "notifications.dispatch", notificationId: n.id });
    }
  }
  return stats;
}
