import { eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { orderItems, orderStatusHistory, orders } from "@/db/schema";
import { hmacHex, safeEqual, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { queueNotification } from "./notifications";
import type { TemplateKey } from "./notifications/templates";

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
  await queueNotification(
    {
      template,
      recipient: opts.recipient ?? order.email,
      userId: opts.recipient ? null : order.userId,
      dedupeKey: opts.dedupeKey,
      payload: { name: order.customerName, orderNumber: order.number, total: order.total, currency: order.currency, items, url: opts.adminUrl ? `${env.appUrl}/admin/orders/${order.id}` : orderUrl(order), ...extra },
    },
    tx,
  );
}

export { db };
