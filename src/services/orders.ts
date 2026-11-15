import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { addresses, cartItems, carts, couponRedemptions, coupons, orderItems, orderStatusHistory, orders, payments, refunds, shipments, type AddressSnapshot } from "@/db/schema";
import { randomToken } from "@/lib/crypto";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { normalizeNigerianPhone } from "@/lib/nigeria";
import { escapeLike } from "@/lib/utils";
import { audit } from "./audit";
import { hasPermission, type SessionUser } from "./auth";
import { evaluateCartCoupon, loadCartLines } from "./cart";
import { listPriceRules } from "./catalog";
import { reserveStock, restockOrder } from "./inventory";
import { notifyOrder, orderAccessToken, orderAccessTokenHash, recordStatus, verifyOrderAccessToken, type OrderRow, type OrderStatus } from "./order-shared";
import { cancelUnpaidOrderTx, createPaymentAttempt, gateways, initializePayment, resolveProvider, verifyPayment } from "./payments";
import type { ProviderKey } from "./payments/types";
import { pricingContextFor } from "./pricing";
import { getSetting } from "./settings";
import { quoteShipping } from "./shipping";
import { computeTotals, MAX_ORDER_TOTAL } from "./totals";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  AWAITING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  READY_FOR_DISPATCH: "Ready for dispatch",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUND_REQUESTED: "Refund requested",
  REFUNDED: "Refunded",
};

/** Fulfilment steps staff may move an order through. PAID is only ever set by verified payment. */
export const FULFILMENT_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PAID: ["PROCESSING"],
  PROCESSING: ["READY_FOR_DISPATCH"],
  READY_FOR_DISPATCH: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
};
const REFUNDABLE: OrderStatus[] = ["PAID", "PROCESSING", "READY_FOR_DISPATCH", "SHIPPED", "DELIVERED"];

function generateOrderNumber(): string {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = Array.from(randomToken(8), (c) => alphabet[c.charCodeAt(0) % alphabet.length]).join("").slice(0, 6);
  return `AUR-${ymd}-${rand}`;
}

export type CreateOrderInput = {
  cartId: string;
  user: SessionUser | null;
  contact: { name: string; email: string; phone: string };
  address: Omit<AddressSnapshot, "country"> & { country?: string };
  shippingMethodId: string;
  notes?: string | null;
  provider?: ProviderKey | null;
  source?: "WEB" | "AI";
  conversationId?: string | null;
  saveAddress?: boolean;
};

export type CreatedOrder = { order: OrderRow; paymentId: string; accessToken: string };

/**
 * Creates an order from a cart in ONE transaction:
 * prices are recomputed on the server, stock is reserved atomically, the coupon is locked and
 * counted, product data is snapshotted into order_items and a PENDING payment row is created.
 * Any failure rolls everything back.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const phone = normalizeNigerianPhone(input.contact.phone);
  const addressPhone = normalizeNigerianPhone(input.address.phone);
  if (!phone || !addressPhone) throw new AppError("Enter a valid Nigerian mobile number.", "INVALID_PHONE");
  const email = input.contact.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Enter a valid email address.", "INVALID_EMAIL");
  const provider = await resolveProvider(input.provider);
  const ctx = pricingContextFor(input.user);
  const [tax, paymentSettings, rules] = await Promise.all([getSetting("tax"), getSetting("payments"), listPriceRules()]);
  await getSetting("notifications"); // warm the cache so the transaction below needs no extra connection

  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        // Locking the cart row serialises double-submits of the same cart.
        const [cart] = await tx.select().from(carts).where(eq(carts.id, input.cartId)).for("update");
        if (!cart || cart.status !== "ACTIVE") throw new AppError("Your cart has already been checked out.", "CART_CONVERTED", 409);
        if (cart.userId && cart.userId !== input.user?.id) throw new ForbiddenError();

        const lines = await loadCartLines(cart.id, ctx, tx, rules);
        if (!lines.length) throw new AppError("Your cart is empty.", "CART_EMPTY");
        const unavailable = lines.find((l) => l.issue === "This product is no longer available.");
        if (unavailable) throw new AppError(`${unavailable.name} is no longer available. Please remove it from your cart.`, "PRODUCT_UNAVAILABLE", 409);

        const [placeholder] = await tx
          .insert(orders)
          .values({
            number: generateOrderNumber(),
            userId: input.user?.id ?? null,
            accessTokenHash: "pending",
            email,
            phone,
            customerName: input.contact.name.trim(),
            status: "AWAITING_PAYMENT",
            pricingTier: lines.some((l) => l.unitPrice < l.listPrice) ? "WHOLESALE" : "RETAIL",
            subtotal: 0,
            total: 0,
            shippingAddress: { fullName: input.address.fullName.trim(), phone: addressPhone, line1: input.address.line1.trim(), line2: input.address.line2?.trim() || null, city: input.address.city.trim(), state: input.address.state, country: input.address.country ?? "NG" },
            shippingMethod: { id: "", name: "", zone: "", provider: "", etaMinDays: 0, etaMaxDays: 0 },
            notes: input.notes?.trim() || null,
            source: input.source ?? "WEB",
            conversationId: input.conversationId ?? null,
            reservationExpiresAt: new Date(Date.now() + paymentSettings.paymentWindowMinutes * 60_000),
          })
          .returning();
        const orderId = placeholder!.id;

        await reserveStock(tx, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, productName: l.name })), orderId);

        const pre = computeTotals(lines);
        let discount = 0;
        let freeShipping = false;
        let couponId: string | null = null;
        if (cart.couponCode) {
          const res = await evaluateCartCoupon(cart.couponCode, { subtotal: pre.subtotal, tier: ctx.tier, userId: input.user?.id, email }, tx, true);
          if (!res.evaluation.valid) throw new AppError(res.evaluation.reason || "This discount code is not valid.", "COUPON_INVALID");
          discount = res.evaluation.discount;
          freeShipping = res.evaluation.freeShipping;
          couponId = res.couponId;
        }
        const shipping = await quoteShipping(input.shippingMethodId, { state: input.address.state, itemCount: pre.itemCount, subtotal: pre.subtotal, freeShipping }, tx);
        const totals = computeTotals(lines, { discount, shippingFee: shipping.fee, tax });
        if (totals.total <= 0) throw new AppError("Order total must be greater than zero.", "INVALID_TOTAL");
        if (totals.total > MAX_ORDER_TOTAL) throw new AppError("This order exceeds the online order limit. Please contact our wholesale team.", "ORDER_TOO_LARGE");

        const [order] = await tx
          .update(orders)
          .set({
            accessTokenHash: orderAccessTokenHash(orderId),
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            shippingTotal: totals.shippingTotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            couponCode: couponId ? cart.couponCode : null,
            shippingMethodId: shipping.id,
            shippingMethod: { id: shipping.id, name: shipping.name, zone: shipping.zone, provider: shipping.provider, etaMinDays: shipping.etaMinDays, etaMaxDays: shipping.etaMaxDays },
          })
          .where(eq(orders.id, orderId))
          .returning();

        await tx.insert(orderItems).values(
          lines.map((l) => ({ orderId, variantId: l.variantId, productId: l.productId, productName: l.name, productSlug: l.slug, variantName: l.variantName, sku: l.sku, imageUrl: l.imageUrl, qualityGrade: l.qualityGrade, warrantyMonths: l.warrantyMonths, unitPrice: l.unitPrice, listPrice: l.listPrice, quantity: l.quantity, lineTotal: l.lineTotal })),
        );
        await tx.insert(orderStatusHistory).values({ orderId, fromStatus: null, toStatus: "AWAITING_PAYMENT", note: input.source === "AI" ? "Order created through the AI shopping assistant." : "Order created.", actorId: input.user?.id ?? null });
        if (couponId) {
          await tx.update(coupons).set({ usedCount: sql`${coupons.usedCount} + 1` }).where(eq(coupons.id, couponId));
          await tx.insert(couponRedemptions).values({ couponId, orderId, userId: input.user?.id ?? null, email, amount: totals.discountTotal });
        }
        const payment = await createPaymentAttempt(tx, order!, provider, paymentSettings.paymentWindowMinutes);
        await tx.update(carts).set({ status: "CONVERTED" }).where(eq(carts.id, cart.id));
        await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));

        if (input.saveAddress && input.user) {
          const [has] = await tx.select({ id: addresses.id }).from(addresses).where(and(eq(addresses.userId, input.user.id), eq(addresses.line1, input.address.line1.trim()), sql`${addresses.deletedAt} is null`)).limit(1);
          if (!has) {
            const [any] = await tx.select({ id: addresses.id }).from(addresses).where(and(eq(addresses.userId, input.user.id), sql`${addresses.deletedAt} is null`)).limit(1);
            await tx.insert(addresses).values({ userId: input.user.id, fullName: input.address.fullName.trim(), phone: addressPhone, line1: input.address.line1.trim(), line2: input.address.line2?.trim() || null, city: input.address.city.trim(), state: input.address.state, isDefault: !any });
          }
        }
        await notifyOrder(tx, order!, "order_confirmation", {}, { dedupeKey: `created:${orderId}` });
        return { order: order!, paymentId: payment.id, accessToken: orderAccessToken(orderId) };
      });
    } catch (e) {
      // Extremely rare order-number collision → retry with a new number.
      const pgErr = (e as { cause?: { constraint?: string } })?.cause ?? (e as { constraint?: string });
      if (attempt < 2 && pgErr?.constraint === "orders_number_unique") continue;
      throw e;
    }
  }
}

/** createOrder + gateway initialisation. If the gateway is unreachable the order remains payable from its page. */
export async function placeOrder(input: CreateOrderInput): Promise<CreatedOrder & { authorizationUrl: string | null; paymentError: string | null }> {
  const created = await createOrder(input);
  try {
    const { authorizationUrl } = await initializePayment(created.paymentId);
    return { ...created, authorizationUrl, paymentError: null };
  } catch (e) {
    return { ...created, authorizationUrl: null, paymentError: e instanceof AppError ? e.message : "Payment could not be started." };
  }
}

/* ───────────────────────── Reading orders ───────────────────────── */

export async function getOrderFull(where: { id: string } | { number: string }) {
  return db.query.orders.findFirst({
    where: "id" in where ? eq(orders.id, where.id) : eq(orders.number, where.number.trim().toUpperCase()),
    with: {
      items: true,
      payments: { orderBy: (p, { desc }) => [desc(p.createdAt)] },
      history: { orderBy: (h, { asc }) => [asc(h.createdAt)], with: { actor: { columns: { name: true } } } },
      shipments: true,
      refunds: { orderBy: (r, { desc }) => [desc(r.createdAt)] },
    },
  });
}
export type OrderFull = NonNullable<Awaited<ReturnType<typeof getOrderFull>>>;

export type Viewer = { user: SessionUser | null; accessToken?: string | null };

export function canViewOrder(order: Pick<OrderRow, "userId" | "accessTokenHash">, viewer: Viewer): boolean {
  if (viewer.user && order.userId === viewer.user.id) return true;
  if (hasPermission(viewer.user, "orders.view")) return true;
  return verifyOrderAccessToken(order, viewer.accessToken);
}

/** Returns the order only when the viewer owns it, holds its secret link, or is authorised staff. */
export async function getOrderForViewer(number: string, viewer: Viewer): Promise<OrderFull | null> {
  const order = await getOrderFull({ number });
  if (!order || !canViewOrder(order, viewer)) return null;
  return order;
}

/** Guest order tracking: order number + the email used at checkout. */
export async function trackOrder(number: string, email: string): Promise<OrderFull | null> {
  const order = await getOrderFull({ number });
  if (!order || order.email.toLowerCase() !== email.trim().toLowerCase()) return null;
  return order;
}

export async function listOrdersForUser(userId: string, limit = 50) {
  return db.query.orders.findMany({ where: eq(orders.userId, userId), orderBy: (o, { desc }) => [desc(o.createdAt)], limit, with: { items: { columns: { productName: true, quantity: true, imageUrl: true } } } });
}

export async function listOrdersAdmin(filter: { q?: string; status?: OrderStatus; page?: number; pageSize?: number }) {
  const pageSize = filter.pageSize ?? 25;
  const page = Math.max(1, filter.page ?? 1);
  const where: SQL[] = [];
  if (filter.status) where.push(eq(orders.status, filter.status));
  if (filter.q?.trim()) {
    const like = `%${escapeLike(filter.q.trim())}%`;
    where.push(or(ilike(orders.number, like), ilike(orders.email, like), ilike(orders.customerName, like), ilike(orders.phone, like))!);
  }
  const cond = where.length ? and(...where) : undefined;
  const [rows, [count]] = await Promise.all([
    db.select().from(orders).where(cond).orderBy(desc(orders.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(cond),
  ]);
  return { rows, total: count?.n ?? 0, page, pageSize, pageCount: Math.max(1, Math.ceil((count?.n ?? 0) / pageSize)) };
}

/* ───────────────────────── Lifecycle changes ───────────────────────── */

const STATUS_TEMPLATE: Partial<Record<OrderStatus, "order_processing" | "order_ready" | "order_shipped" | "order_delivered">> = {
  PROCESSING: "order_processing",
  READY_FOR_DISPATCH: "order_ready",
  SHIPPED: "order_shipped",
  DELIVERED: "order_delivered",
};

export async function updateFulfilmentStatus(orderId: string, to: OrderStatus, actor: SessionUser, details: { note?: string; carrier?: string; trackingNumber?: string; trackingUrl?: string } = {}): Promise<void> {
  if (!hasPermission(actor, "orders.manage")) throw new ForbiddenError();
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new NotFoundError("Order not found.");
    if (!FULFILMENT_TRANSITIONS[order.status]?.includes(to)) throw new AppError(`An order that is "${ORDER_STATUS_LABELS[order.status]}" cannot be moved to "${ORDER_STATUS_LABELS[to]}".`, "INVALID_TRANSITION", 409);
    await recordStatus(tx, order, to, details.note?.trim() || null, actor.id);
    if (to === "SHIPPED") await tx.insert(shipments).values({ orderId, carrier: details.carrier?.trim() || order.shippingMethod.name, trackingNumber: details.trackingNumber?.trim() || null, trackingUrl: details.trackingUrl?.trim() || null, shippedAt: new Date() });
    if (to === "DELIVERED") await tx.update(shipments).set({ deliveredAt: new Date() }).where(eq(shipments.orderId, orderId));
    const template = STATUS_TEMPLATE[to];
    if (template) await notifyOrder(tx, order, template, { carrier: details.carrier, trackingNumber: details.trackingNumber }, { dedupeKey: `${to}:${orderId}` });
    await audit({ actorId: actor.id, action: "order.status_changed", entityType: "order", entityId: orderId, metadata: { number: order.number, from: order.status, to } }, tx);
  });
}

/** Cancels an unpaid order (customer or staff). Checks the gateway first so a paid order is never cancelled. */
export async function cancelOrder(orderId: string, viewer: Viewer, reason: string): Promise<void> {
  const pending = await db.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "PENDING")));
  for (const p of pending) {
    if (!p.authorizationUrl) continue;
    try {
      await verifyPayment(p.reference, "pre-cancel check");
    } catch {
      throw new AppError("We could not confirm the payment status with the provider. Please try again shortly.", "GATEWAY_UNAVAILABLE", 502);
    }
  }
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new NotFoundError("Order not found.");
    const staff = hasPermission(viewer.user, "orders.manage");
    if (!staff && !canViewOrder(order, viewer)) throw new ForbiddenError();
    if (order.status !== "AWAITING_PAYMENT" && order.status !== "PENDING") throw new AppError("Only unpaid orders can be cancelled. For paid orders, request a refund instead.", "INVALID_TRANSITION", 409);
    await cancelUnpaidOrderTx(tx, order, reason.trim().slice(0, 300) || (staff ? "Cancelled by AUREX staff." : "Cancelled by customer."), viewer.user?.id ?? null);
    if (staff) await audit({ actorId: viewer.user!.id, action: "order.cancelled", entityType: "order", entityId: orderId, metadata: { number: order.number } }, tx);
  });
}

export async function requestRefund(orderId: string, viewer: Viewer, reason: string): Promise<void> {
  if (reason.trim().length < 5) throw new AppError("Please tell us why you are requesting a refund.");
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new NotFoundError("Order not found.");
    if (!canViewOrder(order, viewer)) throw new ForbiddenError();
    if (!REFUNDABLE.includes(order.status)) throw new AppError("This order is not eligible for a refund request.", "INVALID_TRANSITION", 409);
    const [payment] = await tx.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "SUCCESS"))).limit(1);
    await tx.insert(refunds).values({ orderId, paymentId: payment?.id ?? null, amount: order.total, reason: reason.trim().slice(0, 1000), requestedBy: viewer.user?.id ?? null });
    await recordStatus(tx, order, "REFUND_REQUESTED", `Refund requested: ${reason.trim().slice(0, 200)}`, viewer.user?.id ?? null);
    await notifyOrder(tx, order, "refund_update", { status: "Requested", note: "Our team will review your request." });
  });
}

/**
 * Approves (and executes with the gateway) or rejects a refund.
 * The gateway call happens before our records change, so a failed call leaves the refund REQUESTED.
 */
export async function decideRefund(refundId: string, actor: SessionUser, decision: { approve: boolean; note?: string; restock?: boolean }): Promise<void> {
  if (!hasPermission(actor, "payments.manage")) throw new ForbiddenError();
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!refund) throw new NotFoundError("Refund not found.");
  if (refund.status !== "REQUESTED") throw new AppError("This refund has already been handled.", "INVALID_TRANSITION", 409);
  const [payment] = refund.paymentId ? await db.select().from(payments).where(eq(payments.id, refund.paymentId)) : [];

  let providerReference: string | null = null;
  if (decision.approve) {
    if (!payment) throw new AppError("No captured payment is linked to this refund. Refund it manually and record the outcome.", "NO_PAYMENT");
    // Claim the refund first so two admins cannot both trigger the gateway.
    const claimed = await db.update(refunds).set({ status: "APPROVED", processedBy: actor.id }).where(and(eq(refunds.id, refundId), eq(refunds.status, "REQUESTED"))).returning();
    if (!claimed.length) throw new AppError("This refund has already been handled.", "INVALID_TRANSITION", 409);
    try {
      providerReference = (await gateways[payment.provider].refund({ reference: payment.reference, transactionId: payment.providerTransactionId, amount: refund.amount })).providerReference;
    } catch (e) {
      await db.update(refunds).set({ status: "REQUESTED", processedBy: null }).where(eq(refunds.id, refundId));
      throw new AppError(`The payment provider rejected the refund: ${e instanceof Error ? e.message : "unknown error"}`, "REFUND_FAILED", 502);
    }
  }

  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, refund.orderId)).for("update");
    if (!order) throw new NotFoundError("Order not found.");
    if (decision.approve) {
      await tx.update(refunds).set({ status: "PROCESSED", providerReference, adminNote: decision.note?.trim() || null, processedBy: actor.id, processedAt: new Date() }).where(eq(refunds.id, refundId));
      const fullRefund = payment && refund.amount >= payment.amount && payment.status === "SUCCESS";
      if (fullRefund) await tx.update(payments).set({ status: "REFUNDED" }).where(eq(payments.id, payment.id));
      // Only a refund of the order's own payment moves the order (duplicate-payment refunds do not).
      if (order.status === "REFUND_REQUESTED") {
        if (decision.restock && order.inventoryState === "COMMITTED") await restockOrder(tx, order.id, actor.id);
        await recordStatus(tx, order, "REFUNDED", decision.note?.trim() || "Refund processed.", actor.id);
      }
      await notifyOrder(tx, order, "refund_update", { status: "Processed", note: "The refund has been sent to your original payment method. Banks usually take 3–10 business days." }, { dedupeKey: `refund:${refundId}` });
    } else {
      await tx.update(refunds).set({ status: "REJECTED", adminNote: decision.note?.trim() || null, processedBy: actor.id, processedAt: new Date() }).where(eq(refunds.id, refundId));
      if (order.status === "REFUND_REQUESTED") {
        const [last] = await tx.select().from(orderStatusHistory).where(and(eq(orderStatusHistory.orderId, order.id), eq(orderStatusHistory.toStatus, "REFUND_REQUESTED"))).orderBy(desc(orderStatusHistory.createdAt)).limit(1);
        const back = last?.fromStatus && REFUNDABLE.includes(last.fromStatus) ? last.fromStatus : "PAID";
        await recordStatus(tx, order, back, `Refund request declined${decision.note ? `: ${decision.note.trim()}` : "."}`, actor.id);
      }
      await notifyOrder(tx, order, "refund_update", { status: "Declined", note: decision.note }, { dedupeKey: `refund:${refundId}` });
    }
    await audit({ actorId: actor.id, action: decision.approve ? "refund.processed" : "refund.rejected", entityType: "refund", entityId: refundId, metadata: { orderNumber: order.number, amount: refund.amount } }, tx);
  });
}

export async function listOpenRefunds() {
  return db.select({ refund: refunds, orderNumber: orders.number, customerName: orders.customerName }).from(refunds).innerJoin(orders, eq(orders.id, refunds.orderId)).where(inArray(refunds.status, ["REQUESTED", "APPROVED"])).orderBy(desc(refunds.createdAt));
}
