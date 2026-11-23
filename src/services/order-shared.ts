import { eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { customerProfiles, orderItems, orderStatusHistory, orders } from "@/db/schema";
import { hmacHex, safeEqual, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { queueNotification } from "./notifications";
import type { TemplateKey } from "./notifications/templates";
import { getSetting } from "./settings";

export type OrderStatus = (typeof orders.$inferSelect)["status"];
export type OrderRow = typeof orders.$inferSelect;

/** Secret link token for guests. Derived from the server secret so emails can always rebuild the link. */
export function orderAccessToken(orderId: string): string {
  return hmacHex("sha256", env.authSecret, `order-access:${orderId}`).slice(0, 40);
}
export const orderAccessTokenHash = (orderId: string) => sha256(orderAccessToken(orderId));
export function verifyOrderAccessToken(order: Pick<OrderRow, "accessTokenHash">, token: string | null | undefined): boolean {
  return !!token && safeEqual(sha256(token), order.accessTokenHash);
}
export function orderUrl(order: Pick<OrderRow, "id" | "number">): string {
  return `${env.appUrl}/orders/${order.number}?t=${orderAccessToken(order.id)}`;
}

export async function recordStatus(tx: DbOrTx, order: Pick<OrderRow, "id" | "status">, to: OrderStatus, note: string | null, actorId: string | null = null, extra: Partial<typeof orders.$inferInsert> = {}): Promise<void> {
  await tx.update(orders).set({ status: to, ...extra }).where(eq(orders.id, order.id));
  await tx.insert(orderStatusHistory).values({ orderId: order.id, fromStatus: order.status, toStatus: to, note, actorId });
}

export async function notifyOrder(tx: DbOrTx, order: OrderRow, template: TemplateKey, extra: Record<string, unknown> = {}, opts: { recipient?: string; dedupeKey?: string; adminUrl?: boolean } = {}): Promise<void> {
  const items = await tx.select({ name: orderItems.productName, quantity: orderItems.quantity, lineTotal: orderItems.lineTotal }).from(orderItems).where(eq(orderItems.orderId, order.id));
  const payload = { name: order.customerName, orderNumber: order.number, total: order.total, currency: order.currency, items, url: opts.adminUrl ? `${env.appUrl}/admin/orders/${order.id}` : orderUrl(order), ...extra };
  await queueNotification(
    {
      template,
      recipient: opts.recipient ?? order.email,
      userId: opts.recipient ? null : order.userId,
      dedupeKey: opts.dedupeKey,
      payload,
    },
    tx,
  );

  // Transactional WhatsApp updates for customers (not admin alerts). Requires whatsapp enabled and a phone number.
  const isAdminAlert = !!opts.recipient || !!opts.adminUrl;
  if (!isAdminAlert && order.phone) {
    try {
      const nSettings = await getSetting("notifications", tx);
      if (nSettings.whatsappEnabled) {
        let allowed = true;
        if (order.userId) {
          const [profile] = await tx.select({ whatsappOptIn: customerProfiles.whatsappOptIn, marketingOptIn: customerProfiles.marketingOptIn }).from(customerProfiles).where(eq(customerProfiles.userId, order.userId));
          // Transactional order updates are allowed unless explicitly opted out in future; respect whatsappOptIn when set.
          if (profile && profile.whatsappOptIn === false) allowed = false;
        }
        if (allowed) {
          await queueNotification({ template, recipient: order.phone, userId: order.userId, dedupeKey: opts.dedupeKey ? `${opts.dedupeKey}:wa` : undefined, payload, channel: "WHATSAPP" }, tx);
        }
      }
    } catch {
      // WhatsApp is best-effort; never block order flow.
    }
  }
}

export { db };
