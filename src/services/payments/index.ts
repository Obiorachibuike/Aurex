import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { couponRedemptions, coupons, orders, paymentEvents, payments, refunds } from "@/db/schema";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError, NotFoundError } from "@/lib/errors";
import { logInfo, reportError } from "@/lib/monitoring";
import { audit } from "../audit";
import { commitReservation, commitWithoutReservation, releaseReservation } from "../inventory";
import { notifyOrder, recordStatus, type OrderRow } from "../order-shared";
import { getSetting } from "../settings";
import { flutterwaveGateway } from "./flutterwave";
import { paystackGateway } from "./paystack";
import type { PaymentGateway, ProviderKey, VerificationResult } from "./types";

export const gateways: Record<ProviderKey, PaymentGateway> = { PAYSTACK: paystackGateway, FLUTTERWAVE: flutterwaveGateway };

export type AvailableProvider = { provider: ProviderKey; label: string; isDefault: boolean };

/** Providers that are both enabled by the administrator and have server credentials. */
export async function getAvailableProviders(): Promise<AvailableProvider[]> {
  const s = await getSetting("payments");
  const enabled: ProviderKey[] = [];
  if (s.paystackEnabled && paystackGateway.isConfigured()) enabled.push("PAYSTACK");
  if (s.flutterwaveEnabled && flutterwaveGateway.isConfigured()) enabled.push("FLUTTERWAVE");
  const def = enabled.includes(s.defaultProvider) ? s.defaultProvider : enabled[0];
  return enabled.map((p) => ({ provider: p, label: gateways[p].label, isDefault: p === def }));
}

export async function resolveProvider(requested?: ProviderKey | null): Promise<ProviderKey> {
  const available = await getAvailableProviders();
  if (!available.length) throw new AppError("Online payment is not available right now. Please contact support.", "PAYMENTS_UNAVAILABLE", 503);
  const match = requested ? available.find((a) => a.provider === requested) : available.find((a) => a.isDefault);
  if (!match) throw new AppError("That payment method is not available.", "PAYMENT_PROVIDER_UNAVAILABLE");
  return match.provider;
}

export function newPaymentReference(orderNumber: string): string {
  return `${orderNumber}-${randomToken(6).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

export async function createPaymentAttempt(tx: DbOrTx, order: Pick<OrderRow, "id" | "number" | "total" | "currency">, provider: ProviderKey, windowMinutes: number) {
  const [p] = await tx
    .insert(payments)
    .values({ orderId: order.id, provider, reference: newPaymentReference(order.number), amount: order.total, currency: order.currency, expiresAt: new Date(Date.now() + windowMinutes * 60_000) })
    .returning();
  return p!;
}

/** Calls the gateway to start a payment for an existing PENDING payment row. */
export async function initializePayment(paymentId: string): Promise<{ authorizationUrl: string; reference: string }> {
  const [row] = await db.select({ payment: payments, order: orders }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(payments.id, paymentId));
  if (!row) throw new NotFoundError("Payment not found.");
  const { payment, order } = row;
  if (payment.status !== "PENDING") throw new AppError("This payment can no longer be started.", "PAYMENT_NOT_PENDING");
  if (payment.authorizationUrl) return { authorizationUrl: payment.authorizationUrl, reference: payment.reference };
  try {
    const { authorizationUrl } = await gateways[payment.provider].initialize({
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      email: order.email,
      customerName: order.customerName,
      phone: order.phone,
      callbackUrl: `${env.appUrl}/checkout/callback?provider=${payment.provider.toLowerCase()}`,
      metadata: { order_number: order.number, order_id: order.id },
    });
    await db.update(payments).set({ authorizationUrl }).where(eq(payments.id, payment.id));
    return { authorizationUrl, reference: payment.reference };
  } catch (e) {
    await db.update(payments).set({ status: "FAILED", failureReason: `Initialization failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}` }).where(and(eq(payments.id, payment.id), eq(payments.status, "PENDING")));
    reportError(e, { scope: "payments.initialize", reference: payment.reference });
    throw new AppError("We could not reach the payment provider. Your order is saved — please try paying again from the order page.", "PAYMENT_INIT_FAILED", 502);
  }
}

/** Starts a fresh payment attempt for an order that is still awaiting payment. */
export async function retryPayment(orderId: string, requested?: ProviderKey | null): Promise<{ authorizationUrl: string; reference: string }> {
  const provider = await resolveProvider(requested);
  const { paymentWindowMinutes } = await getSetting("payments");
  const payment = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new NotFoundError("Order not found.");
    if (order.status !== "AWAITING_PAYMENT") throw new AppError("This order is not awaiting payment.", "ORDER_NOT_PAYABLE");
    const [open] = await tx.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "PENDING"), eq(payments.provider, provider), sql`${payments.expiresAt} > now()`)).limit(1);
    if (open?.authorizationUrl) return open;
    await tx.update(orders).set({ reservationExpiresAt: new Date(Date.now() + paymentWindowMinutes * 60_000) }).where(eq(orders.id, orderId));
    return open ?? (await createPaymentAttempt(tx, order, provider, paymentWindowMinutes));
  });
  return initializePayment(payment.id);
}

export type ApplyOutcome = "PAID" | "ALREADY_PAID" | "DUPLICATE_PAYMENT" | "PAID_OUT_OF_STOCK" | "AMOUNT_MISMATCH" | "FAILED" | "PENDING" | "UNKNOWN_REFERENCE";

/**
 * Applies a gateway verification result to our records. Idempotent: repeated calls for the same
 * successful payment (webhook retries, callback + webhook races) change nothing after the first.
 */
export async function applyVerification(reference: string, v: VerificationResult, source: string): Promise<ApplyOutcome> {
  return db.transaction(async (tx) => {
    const [peek] = await tx.select({ orderId: payments.orderId }).from(payments).where(eq(payments.reference, reference));
    if (!peek) return "UNKNOWN_REFERENCE";
    // Lock order first, then payment — the same order every writer uses, so no deadlocks.
    const [order] = await tx.select().from(orders).where(eq(orders.id, peek.orderId)).for("update");
    const [payment] = await tx.select().from(payments).where(eq(payments.reference, reference)).for("update");
    if (!order || !payment) return "UNKNOWN_REFERENCE";

    if (v.status === "pending") return "PENDING";
    if (payment.status === "SUCCESS" || payment.status === "REFUNDED") return "ALREADY_PAID";

    if (v.status !== "success") {
      await tx.update(payments).set({ status: v.status === "abandoned" ? "ABANDONED" : "FAILED", failureReason: v.message?.slice(0, 300) ?? "Payment was not completed", verifiedAt: new Date() }).where(eq(payments.id, payment.id));
      return "FAILED";
    }

    const base = { providerTransactionId: v.transactionId, channel: v.channel, verifiedAt: new Date(), paidAt: v.paidAt ?? new Date() };

    if (v.amount !== payment.amount || v.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      await tx.update(payments).set({ ...base, status: "FAILED", failureReason: `Amount mismatch: expected ${payment.amount} ${payment.currency}, gateway reported ${v.amount} ${v.currency}` }).where(eq(payments.id, payment.id));
      if (v.amount > 0) await tx.insert(refunds).values({ orderId: order.id, paymentId: payment.id, amount: v.amount, reason: "Amount paid did not match the order total — needs manual review." });
      await audit({ action: "payment.amount_mismatch", entityType: "payment", entityId: payment.id, metadata: { expected: payment.amount, received: v.amount, source } }, tx);
      return "AMOUNT_MISMATCH";
    }

    await tx.update(payments).set({ ...base, status: "SUCCESS", failureReason: null }).where(eq(payments.id, payment.id));

    if (order.status === "AWAITING_PAYMENT" || order.status === "PENDING") {
      await commitReservation(tx, order.id);
      await markPaid(tx, order, `Payment verified via ${payment.provider} (${source}).`);
      return "PAID";
    }
    if (order.status === "CANCELLED" && order.inventoryState === "RELEASED") {
      if (await commitWithoutReservation(tx, order.id)) {
        await tx.update(couponRedemptions).set({ voidedAt: null }).where(eq(couponRedemptions.orderId, order.id));
        await markPaid(tx, order, "Payment arrived after the order expired; stock was still available so the order was reinstated.");
        return "PAID";
      }
      await tx.insert(refunds).values({ orderId: order.id, paymentId: payment.id, amount: payment.amount, reason: "Payment arrived after the reservation expired and the items are no longer in stock." });
      await recordStatus(tx, order, "REFUND_REQUESTED", "Paid after expiry but stock is gone — refund required.", null, { paidAt: new Date(), cancelledAt: null });
      await notifyOrder(tx, order, "refund_update", { status: "Refund requested", note: "Your payment arrived after the items sold out. We will refund you in full." }, { dedupeKey: `late-refund:${payment.id}` });
      return "PAID_OUT_OF_STOCK";
    }
    // Order already paid by another attempt → flag the extra money for refund.
    await tx.insert(refunds).values({ orderId: order.id, paymentId: payment.id, amount: payment.amount, reason: "Duplicate payment for an order that was already paid." });
    await audit({ action: "payment.duplicate", entityType: "payment", entityId: payment.id, metadata: { orderNumber: order.number, source } }, tx);
    return "DUPLICATE_PAYMENT";
  });
}

async function markPaid(tx: DbOrTx, order: OrderRow, note: string) {
  await recordStatus(tx, order, "PAID", note, null, { paidAt: new Date(), cancelledAt: null });
  await notifyOrder(tx, order, "payment_confirmation", {}, { dedupeKey: `paid:${order.id}` });
  const { newOrderEmail } = await getSetting("notifications", tx);
  if (newOrderEmail) await notifyOrder(tx, order, "new_order_alert", {}, { recipient: newOrderEmail, dedupeKey: `paid-alert:${order.id}`, adminUrl: true });
}

/** Asks the gateway for the truth about a reference and applies it. */
export async function verifyPayment(reference: string, source: string): Promise<{ outcome: ApplyOutcome; orderId: string | null }> {
  const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));
  if (!payment) return { outcome: "UNKNOWN_REFERENCE", orderId: null };
  if (payment.status === "SUCCESS" || payment.status === "REFUNDED") return { outcome: "ALREADY_PAID", orderId: payment.orderId };
  const result = await gateways[payment.provider].verify(reference);
  return { outcome: await applyVerification(reference, result, source), orderId: payment.orderId };
}

export type WebhookResult = { status: "invalid_signature" | "duplicate" | "processed" | "ignored"; outcome?: ApplyOutcome };

/**
 * Webhook entry point. Order of operations:
 *  1. verify the signature against the raw body;
 *  2. record the event under a unique key (duplicates stop here);
 *  3. re-verify the transaction with the gateway API — the webhook body is never trusted for amounts or status.
 */
export async function handleWebhook(provider: ProviderKey, rawBody: string, headers: Headers): Promise<WebhookResult> {
  const event = gateways[provider].parseWebhook(rawBody, headers);
  if (!event) return { status: "invalid_signature" };
  const inserted = await db
    .insert(paymentEvents)
    .values({ provider, eventKey: event.eventKey, eventType: event.eventType, reference: event.reference, payload: JSON.parse(rawBody) })
    .onConflictDoNothing()
    .returning({ id: paymentEvents.id });
  let eventId = inserted[0]?.id;
  if (!eventId) {
    const [existing] = await db.select().from(paymentEvents).where(and(eq(paymentEvents.provider, provider), eq(paymentEvents.eventKey, event.eventKey)));
    if (!existing || existing.processedAt) return { status: "duplicate" };
    eventId = existing.id; // earlier delivery crashed before finishing → process again
  }
  if (!event.isChargeEvent || !event.reference) {
    await db.update(paymentEvents).set({ processedAt: new Date(), outcome: "ignored" }).where(eq(paymentEvents.id, eventId));
    return { status: "ignored" };
  }
  const { outcome } = await verifyPayment(event.reference, "webhook");
  await db.update(paymentEvents).set({ processedAt: new Date(), outcome }).where(eq(paymentEvents.id, eventId));
  logInfo("payments.webhook", { provider, eventType: event.eventType, reference: event.reference, outcome });
  return { status: "processed", outcome };
}

/** Cancels an unpaid order and frees its stock. Caller must have locked the order row. */
export async function cancelUnpaidOrderTx(tx: DbOrTx, order: OrderRow, note: string, actorId: string | null, notify = true): Promise<void> {
  if (order.inventoryState === "RESERVED") await releaseReservation(tx, order.id);
  await tx.update(payments).set({ status: "ABANDONED", failureReason: "Order cancelled before payment" }).where(and(eq(payments.orderId, order.id), eq(payments.status, "PENDING")));
  const voided = await tx.update(couponRedemptions).set({ voidedAt: new Date() }).where(and(eq(couponRedemptions.orderId, order.id), sql`${couponRedemptions.voidedAt} is null`)).returning({ couponId: couponRedemptions.couponId });
  for (const v of voided) await tx.update(coupons).set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` }).where(eq(coupons.id, v.couponId));
  await recordStatus(tx, order, "CANCELLED", note, actorId, { cancelledAt: new Date() });
  if (notify) await notifyOrder(tx, order, "order_cancelled", { reason: note }, { dedupeKey: `cancelled:${order.id}` });
}

/**
 * Payment timeout handling and reconciliation (run from cron):
 * every expired PENDING payment is checked with the gateway. Paid ones are applied; the rest are
 * closed, and orders with no live payment attempt are cancelled so reserved stock is released.
 */
export async function reconcilePayments(now = new Date()): Promise<{ checked: number; paid: number; expired: number; cancelledOrders: number }> {
  const stats = { checked: 0, paid: 0, expired: 0, cancelledOrders: 0 };
  const stale = await db.select().from(payments).where(and(eq(payments.status, "PENDING"), lt(payments.expiresAt, now))).limit(100);
  for (const p of stale) {
    stats.checked++;
    try {
      const result = await gateways[p.provider].verify(p.reference);
      if (result.status === "success") {
        const outcome = await applyVerification(p.reference, result, "reconciliation");
        if (outcome === "PAID" || outcome === "ALREADY_PAID") stats.paid++;
        continue;
      }
      await db.update(payments).set({ status: result.status === "failed" ? "FAILED" : "ABANDONED", failureReason: result.message?.slice(0, 300) ?? "Payment window expired", verifiedAt: now }).where(and(eq(payments.id, p.id), eq(payments.status, "PENDING")));
      stats.expired++;
    } catch (e) {
      reportError(e, { scope: "payments.reconcile", reference: p.reference });
    }
  }
  const candidates = await db.select({ id: orders.id }).from(orders).where(and(inArray(orders.status, ["AWAITING_PAYMENT", "PENDING"]), lt(orders.reservationExpiresAt, now))).limit(100);
  for (const c of candidates) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, c.id)).for("update");
      if (!order || (order.status !== "AWAITING_PAYMENT" && order.status !== "PENDING")) return;
      const [live] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.orderId, order.id), eq(payments.status, "PENDING"))).limit(1);
      if (live) return; // still being verified; try again next run
      await cancelUnpaidOrderTx(tx, order, "Payment was not completed in time.", null);
      stats.cancelledOrders++;
    });
  }
  return stats;
}
