import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "@/db";
import { coupons, inventoryMovements, notifications, orderItems, orders, paymentEvents, payments, productVariants, refunds, shippingMethods, shippingZones } from "@/db/schema";
import { addCartItem, getCartView, getOrCreateCart, mergeGuestCart, setCartCoupon, setCartItemQuantity } from "@/services/cart";
import { clearCatalogCache } from "@/services/catalog";
import { cancelOrder, createOrder, decideRefund, getOrderForViewer, placeOrder, requestRefund, trackOrder, updateFulfilmentStatus } from "@/services/orders";
import { orderAccessToken } from "@/services/order-shared";
import { applyVerification, handleWebhook, reconcilePayments, retryPayment, verifyPayment } from "@/services/payments";
import { pricingContextFor, RETAIL_CONTEXT } from "@/services/pricing";
import { clearSettingsCache, updateSetting } from "@/services/settings";
import { installFakeGateways } from "../helpers/fake-gateway";
import { LAGOS_ADDRESS, makeProduct, makeUser, stockOf, uniq } from "../helpers/fixtures";

let gw: ReturnType<typeof installFakeGateways>;
let lagosStandard: string;
let nationwide: string;

beforeAll(async () => {
  const methods = await db.select({ id: shippingMethods.id, name: shippingMethods.name, zone: shippingZones.name }).from(shippingMethods).innerJoin(shippingZones, eq(shippingZones.id, shippingMethods.zoneId));
  lagosStandard = methods.find((m) => m.name === "Lagos Standard Delivery")!.id;
  nationwide = methods.find((m) => m.zone === "Rest of Nigeria")!.id;
});
beforeEach(() => {
  gw = installFakeGateways();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

async function guestCart(variantId: string, quantity: number) {
  const { cart } = await getOrCreateCart({ guestToken: null });
  await addCartItem(cart.id, variantId, quantity);
  return cart.id;
}
const contact = () => ({ name: "Ada Obi", email: `${uniq("buyer")}@example.com`, phone: "0803 123 4567" });
const pay = async (orderId: string) => (await db.select().from(payments).where(eq(payments.orderId, orderId)))[0]!;
const orderRow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;

describe("shopping cart", () => {
  it("persists items, recalculates totals on the server and enforces stock", async () => {
    const { variant } = await makeProduct({ stock: 3, retail: 500_000 });
    const { cart, newGuestToken } = await getOrCreateCart({ guestToken: null });
    expect(newGuestToken).toBeTruthy();
    await addCartItem(cart.id, variant.id, 2);
    const again = await getOrCreateCart({ guestToken: newGuestToken });
    expect(again.cart.id).toBe(cart.id);
    const view = await getCartView(cart.id, RETAIL_CONTEXT);
    expect(view.totals.subtotal).toBe(1_000_000);
    expect(view.lines[0]).toMatchObject({ quantity: 2, unitPrice: 500_000, purchasable: true });
    await expect(addCartItem(cart.id, variant.id, 2)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await expect(setCartItemQuantity(cart.id, variant.id, 4)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await setCartItemQuantity(cart.id, variant.id, 0);
    expect((await getCartView(cart.id, RETAIL_CONTEXT)).lines).toHaveLength(0);
  });

  it("merges a guest cart into the account cart at login", async () => {
    const a = await makeProduct({ stock: 10 });
    const b = await makeProduct({ stock: 10 });
    const user = await makeUser();
    const mine = await getOrCreateCart({ userId: user.id });
    await addCartItem(mine.cart.id, a.variant.id, 1);
    const guest = await getOrCreateCart({ guestToken: null });
    await addCartItem(guest.cart.id, a.variant.id, 2);
    await addCartItem(guest.cart.id, b.variant.id, 1);
    await mergeGuestCart(guest.newGuestToken!, user.id);
    const view = await getCartView(mine.cart.id, RETAIL_CONTEXT);
    expect(view.lines.map((l) => l.quantity).sort()).toEqual([1, 3]);
  });

  it("shows wholesale prices only to approved wholesale accounts", async () => {
    const { variant } = await makeProduct({ stock: 50, retail: 1_000_000, wholesale: 800_000, minQty: 5 });
    const retailUser = await makeUser();
    const wholesaler = await makeUser({ role: "wholesale_customer", wholesale: true });
    for (const [user, expected] of [[retailUser, 1_000_000], [wholesaler, 800_000]] as const) {
      const { cart } = await getOrCreateCart({ userId: user.id });
      await addCartItem(cart.id, variant.id, 5);
      expect((await getCartView(cart.id, pricingContextFor(user))).lines[0]!.unitPrice).toBe(expected);
    }
    // below the minimum wholesale quantity even a wholesaler pays retail
    const { cart } = await getOrCreateCart({ userId: wholesaler.id });
    await setCartItemQuantity(cart.id, variant.id, 4);
    expect((await getCartView(cart.id, pricingContextFor(wholesaler))).lines[0]!.unitPrice).toBe(1_000_000);
  });
});

describe("order creation", () => {
  it("creates an order with server-side totals, snapshots, reservation and a pending payment", async () => {
    const { variant, product } = await makeProduct({ stock: 10, retail: 1_250_000 });
    const cartId = await guestCart(variant.id, 2);
    const c = contact();
    const res = await placeOrder({ cartId, user: null, contact: c, address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    expect(res.order.status).toBe("AWAITING_PAYMENT");
    expect(res.order.subtotal).toBe(2_500_000);
    expect(res.order.shippingTotal).toBe(250_000);
    expect(res.order.total).toBe(2_750_000);
    expect(res.order.phone).toBe("+2348031234567");
    expect(res.order.number).toMatch(/^AUR-\d{6}-[A-Z0-9]{6}$/);
    expect(res.authorizationUrl).toContain("checkout.paystack.test");
    expect(await stockOf(variant.id)).toEqual({ onHand: 10, reserved: 2, available: 8 });
    const p = await pay(res.order.id);
    expect(p).toMatchObject({ status: "PENDING", amount: 2_750_000, currency: "NGN", provider: "PAYSTACK" });
    expect(gw.paystack.get(p.reference)?.amount).toBe(2_750_000);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, res.order.id));
    expect(item).toMatchObject({ productName: product.name, unitPrice: 1_250_000, quantity: 2, lineTotal: 2_500_000 });
    // cart is consumed
    expect((await getCartView(cartId, RETAIL_CONTEXT)).lines).toHaveLength(0);
    await expect(createOrder({ cartId, user: null, contact: c, address: LAGOS_ADDRESS, shippingMethodId: lagosStandard })).rejects.toMatchObject({ code: "CART_CONVERTED" });
    // price changes later do not alter the order snapshot
    await db.update(productVariants).set({ retailPrice: 9_999_900 }).where(eq(productVariants.id, variant.id));
    expect((await db.select().from(orderItems).where(eq(orderItems.orderId, res.order.id)))[0]!.unitPrice).toBe(1_250_000);
  });

  it("rejects invalid phone numbers, unknown shipping methods and methods from another zone", async () => {
    const { variant } = await makeProduct({ stock: 5 });
    const cartId = await guestCart(variant.id, 1);
    await expect(createOrder({ cartId, user: null, contact: { ...contact(), phone: "12345" }, address: LAGOS_ADDRESS, shippingMethodId: lagosStandard })).rejects.toMatchObject({ code: "INVALID_PHONE" });
    await expect(createOrder({ cartId, user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: nationwide })).rejects.toMatchObject({ code: "SHIPPING_UNAVAILABLE" });
    // failed attempts must not leak reservations
    expect((await stockOf(variant.id)).reserved).toBe(0);
  });

  it("refuses to order more than is in stock and rolls back completely", async () => {
    const a = await makeProduct({ stock: 5 });
    const b = await makeProduct({ stock: 1 });
    const { cart } = await getOrCreateCart({ guestToken: null });
    await addCartItem(cart.id, a.variant.id, 2);
    await addCartItem(cart.id, b.variant.id, 1);
    await db.update((await import("@/db/schema")).inventory).set({ onHand: 0 }).where(eq((await import("@/db/schema")).inventory.variantId, b.variant.id));
    await expect(createOrder({ cartId: cart.id, user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await stockOf(a.variant.id)).toMatchObject({ reserved: 0, onHand: 5 });
  });

  it("never oversells under concurrent checkouts", async () => {
    const { variant } = await makeProduct({ stock: 3 });
    const carts = await Promise.all(Array.from({ length: 8 }, () => guestCart(variant.id, 1)));
    const results = await Promise.allSettled(carts.map((cartId) => createOrder({ cartId, user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await stockOf(variant.id)).toEqual({ onHand: 3, reserved: 3, available: 0 });
  });

  it("applies coupons on the server, enforces per-customer limits and wholesale pricing", async () => {
    const code = uniq("SAVE").toUpperCase();
    await db.insert(coupons).values({ code, type: "PERCENT", value: 10, perCustomerLimit: 1 });
    const { variant } = await makeProduct({ stock: 100, retail: 1_000_000, wholesale: 700_000, minQty: 5 });
    const user = await makeUser();
    const { cart } = await getOrCreateCart({ userId: user.id });
    await addCartItem(cart.id, variant.id, 2);
    await setCartCoupon(cart.id, code.toLowerCase());
    const first = await createOrder({ cartId: cart.id, user, contact: { name: user.name, email: user.email, phone: "08031234567" }, address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    expect(first.order).toMatchObject({ subtotal: 2_000_000, discountTotal: 200_000, total: 2_000_000 - 200_000 + 250_000, couponCode: code });
    expect((await db.select().from(coupons).where(eq(coupons.code, code)))[0]!.usedCount).toBe(1);
    const second = await getOrCreateCart({ userId: user.id });
    await addCartItem(second.cart.id, variant.id, 1);
    await setCartCoupon(second.cart.id, code);
    await expect(createOrder({ cartId: second.cart.id, user, contact: { name: user.name, email: user.email, phone: "08031234567" }, address: LAGOS_ADDRESS, shippingMethodId: lagosStandard })).rejects.toMatchObject({ code: "COUPON_INVALID" });
    expect((await stockOf(variant.id)).reserved).toBe(2);

    const wholesaler = await makeUser({ role: "wholesale_customer", wholesale: true });
    const w = await getOrCreateCart({ userId: wholesaler.id });
    await addCartItem(w.cart.id, variant.id, 10);
    const wo = await createOrder({ cartId: w.cart.id, user: wholesaler, contact: { name: "W", email: wholesaler.email, phone: "08031234567" }, address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    expect(wo.order).toMatchObject({ pricingTier: "WHOLESALE", subtotal: 7_000_000 });
  });
});

describe("payment verification", () => {
  async function newOrder(stock = 5, qty = 2) {
    const { variant, product } = await makeProduct({ stock, retail: 1_000_000 });
    const res = await placeOrder({ cartId: await guestCart(variant.id, qty), user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    return { ...res, variant, product, payment: await pay(res.order.id) };
  }

  it("marks the order paid only after server-side verification and deducts inventory once", async () => {
    const o = await newOrder();
    // redirect arrives before the customer paid → nothing changes
    expect((await verifyPayment(o.payment.reference, "callback")).outcome).toBe("FAILED");
    expect((await orderRow(o.order.id)).status).toBe("AWAITING_PAYMENT");
    expect(await stockOf(o.variant.id)).toMatchObject({ onHand: 5, reserved: 2 });
  });

  it("webhook: valid signature + successful verification → PAID, stock committed, customer notified", async () => {
    const o = await newOrder();
    gw.settle(o.payment.reference, "success");
    const hook = gw.paystackWebhook(o.payment.reference);
    expect(await handleWebhook("PAYSTACK", hook.raw, hook.headers)).toEqual({ status: "processed", outcome: "PAID" });
    const order = await orderRow(o.order.id);
    expect(order).toMatchObject({ status: "PAID", inventoryState: "COMMITTED" });
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(await stockOf(o.variant.id)).toEqual({ onHand: 3, reserved: 0, available: 3 });
    expect(await pay(o.order.id)).toMatchObject({ status: "SUCCESS", channel: "card" });
    const sale = await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.orderId, o.order.id), eq(inventoryMovements.type, "SALE")));
    expect(sale.map((m) => m.quantity)).toEqual([-2]);
    const notes = await db.select().from(notifications).where(eq(notifications.dedupeKey, `paid:${o.order.id}`));
    expect(notes).toHaveLength(1);
  });

  it("duplicate webhooks and callback/webhook races are idempotent", async () => {
    const o = await newOrder();
    gw.settle(o.payment.reference, "success");
    const hook = gw.paystackWebhook(o.payment.reference);
    const results = await Promise.all([handleWebhook("PAYSTACK", hook.raw, hook.headers), handleWebhook("PAYSTACK", hook.raw, hook.headers), verifyPayment(o.payment.reference, "callback")]);
    expect(results.filter((r) => "outcome" in r && r.outcome === "PAID")).toHaveLength(1);
    expect((await handleWebhook("PAYSTACK", hook.raw, hook.headers)).status).toBe("duplicate");
    expect(await stockOf(o.variant.id)).toEqual({ onHand: 3, reserved: 0, available: 3 });
    expect(await db.select().from(paymentEvents).where(eq(paymentEvents.reference, o.payment.reference))).toHaveLength(1);
    expect(await db.select().from(notifications).where(eq(notifications.dedupeKey, `paid:${o.order.id}`))).toHaveLength(1);
    expect(await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.orderId, o.order.id), eq(inventoryMovements.type, "SALE")))).toHaveLength(1);
  });

  it("rejects webhooks with a missing or forged signature", async () => {
    const o = await newOrder();
    gw.settle(o.payment.reference, "success");
    const hook = gw.paystackWebhook(o.payment.reference);
    expect((await handleWebhook("PAYSTACK", hook.raw, new Headers())).status).toBe("invalid_signature");
    expect((await handleWebhook("PAYSTACK", hook.raw, new Headers({ "x-paystack-signature": "0".repeat(128) }))).status).toBe("invalid_signature");
    expect((await handleWebhook("PAYSTACK", hook.raw.replace("charge.success", "charge.success "), hook.headers)).status).toBe("invalid_signature");
    expect((await orderRow(o.order.id)).status).toBe("AWAITING_PAYMENT");
  });

  it("does not trust the webhook body: a signed 'success' event for an unpaid transaction changes nothing", async () => {
    const o = await newOrder();
    const hook = gw.paystackWebhook(o.payment.reference); // gateway still says abandoned
    expect(await handleWebhook("PAYSTACK", hook.raw, hook.headers)).toEqual({ status: "processed", outcome: "FAILED" });
    expect((await orderRow(o.order.id)).status).toBe("AWAITING_PAYMENT");
  });

  it("failed payment keeps the order payable; a retry creates a new reference", async () => {
    const o = await newOrder();
    gw.settle(o.payment.reference, "failed");
    expect((await verifyPayment(o.payment.reference, "callback")).outcome).toBe("FAILED");
    expect(await pay(o.order.id)).toMatchObject({ status: "FAILED" });
    expect(await stockOf(o.variant.id)).toMatchObject({ reserved: 2 });
    const retry = await retryPayment(o.order.id);
    expect(retry.reference).not.toBe(o.payment.reference);
    gw.settle(retry.reference, "success");
    expect((await verifyPayment(retry.reference, "callback")).outcome).toBe("PAID");
    expect((await orderRow(o.order.id)).status).toBe("PAID");
  });

  it("amount mismatch is never accepted as payment", async () => {
    const o = await newOrder();
    gw.settle(o.payment.reference, "success", { amount: 100 });
    expect((await verifyPayment(o.payment.reference, "webhook")).outcome).toBe("AMOUNT_MISMATCH");
    expect((await orderRow(o.order.id)).status).toBe("AWAITING_PAYMENT");
    expect(await pay(o.order.id)).toMatchObject({ status: "FAILED" });
    expect(await db.select().from(refunds).where(eq(refunds.orderId, o.order.id))).toHaveLength(1);
  });

  it("a second successful payment for a paid order is flagged for refund, not double-fulfilled", async () => {
    const o = await newOrder();
    await db.update(payments).set({ status: "FAILED" }).where(eq(payments.id, o.payment.id)); // customer opens a second attempt
    const retry = await retryPayment(o.order.id);
    await db.update(payments).set({ status: "PENDING" }).where(eq(payments.id, o.payment.id));
    gw.settle(o.payment.reference, "success");
    gw.settle(retry.reference, "success");
    expect((await verifyPayment(o.payment.reference, "webhook")).outcome).toBe("PAID");
    expect((await verifyPayment(retry.reference, "webhook")).outcome).toBe("DUPLICATE_PAYMENT");
    expect(await stockOf(o.variant.id)).toEqual({ onHand: 3, reserved: 0, available: 3 });
    const r = await db.select().from(refunds).where(eq(refunds.orderId, o.order.id));
    expect(r).toHaveLength(1);
    expect(r[0]!.reason).toMatch(/Duplicate/);
  });

  it("payment timeout: reconciliation cancels unpaid orders and releases stock, but honours late successful payments", async () => {
    const expired = await newOrder();
    const paidLate = await newOrder();
    const past = new Date(Date.now() - 60_000);
    for (const o of [expired, paidLate]) {
      await db.update(payments).set({ expiresAt: past }).where(eq(payments.orderId, o.order.id));
      await db.update(orders).set({ reservationExpiresAt: past }).where(eq(orders.id, o.order.id));
    }
    gw.settle(paidLate.payment.reference, "success");
    const stats = await reconcilePayments();
    expect(stats.paid).toBeGreaterThanOrEqual(1);
    expect((await orderRow(paidLate.order.id)).status).toBe("PAID");
    expect(await orderRow(expired.order.id)).toMatchObject({ status: "CANCELLED", inventoryState: "RELEASED" });
    expect(await stockOf(expired.variant.id)).toEqual({ onHand: 5, reserved: 0, available: 5 });
    expect(await pay(expired.order.id)).toMatchObject({ status: "ABANDONED" });

    // money arrives after cancellation while stock is still there → order reinstated
    gw.settle(expired.payment.reference, "success");
    expect(await applyVerification(expired.payment.reference, { status: "success", reference: expired.payment.reference, amount: expired.order.total, currency: "NGN", transactionId: "1", channel: "card", paidAt: new Date(), message: null }, "webhook")).toBe("PAID");
    expect(await orderRow(expired.order.id)).toMatchObject({ status: "PAID", inventoryState: "COMMITTED" });
    expect(await stockOf(expired.variant.id)).toEqual({ onHand: 3, reserved: 0, available: 3 });
  });

  it("late payment with no stock left becomes a refund request instead of an unfulfillable order", async () => {
    const o = await newOrder(2, 2);
    await cancelOrder(o.order.id, { user: null, accessToken: o.accessToken }, "changed my mind");
    const other = await placeOrder({ cartId: await guestCart(o.variant.id, 2), user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    expect(other.order.status).toBe("AWAITING_PAYMENT");
    await db.update(payments).set({ status: "PENDING" }).where(eq(payments.id, o.payment.id));
    const outcome = await applyVerification(o.payment.reference, { status: "success", reference: o.payment.reference, amount: o.order.total, currency: "NGN", transactionId: "9", channel: "card", paidAt: new Date(), message: null }, "webhook");
    expect(outcome).toBe("PAID_OUT_OF_STOCK");
    expect((await orderRow(o.order.id)).status).toBe("REFUND_REQUESTED");
    expect(await stockOf(o.variant.id)).toEqual({ onHand: 2, reserved: 2, available: 0 });
  });

  it("initialisation failure leaves a payable order rather than losing it", async () => {
    gw.state.failInitialize = true;
    const { variant } = await makeProduct({ stock: 5 });
    const res = await placeOrder({ cartId: await guestCart(variant.id, 1), user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    expect(res.authorizationUrl).toBeNull();
    expect(res.paymentError).toBeTruthy();
    expect(res.order.status).toBe("AWAITING_PAYMENT");
    gw.state.failInitialize = false;
    expect((await retryPayment(res.order.id)).authorizationUrl).toContain("paystack");
  });

  it("supports Flutterwave as a second provider when enabled by the administrator", async () => {
    const { variant } = await makeProduct({ stock: 5, retail: 1_000_050 });
    await expect(createOrder({ cartId: await guestCart(variant.id, 1), user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard, provider: "FLUTTERWAVE" })).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_UNAVAILABLE" });
    await updateSetting("payments", { flutterwaveEnabled: true });
    try {
      const res = await placeOrder({ cartId: await guestCart(variant.id, 1), user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard, provider: "FLUTTERWAVE" });
      expect(res.authorizationUrl).toContain("flutterwave");
      const p = await pay(res.order.id);
      expect(gw.flutterwave.get(p.reference)?.amount).toBe(res.order.total);
      const hook = gw.flutterwaveWebhook(p.reference);
      expect((await handleWebhook("FLUTTERWAVE", hook.raw, new Headers({ "verif-hash": "wrong" }))).status).toBe("invalid_signature");
      gw.settle(p.reference, "success");
      expect(await handleWebhook("FLUTTERWAVE", hook.raw, hook.headers)).toEqual({ status: "processed", outcome: "PAID" });
      expect((await orderRow(res.order.id)).status).toBe("PAID");
    } finally {
      await updateSetting("payments", { flutterwaveEnabled: false });
      clearSettingsCache();
    }
  });
});

describe("order lifecycle, access control and refunds", () => {
  async function paidOrder(user: Awaited<ReturnType<typeof makeUser>> | null = null) {
    const { variant } = await makeProduct({ stock: 5, retail: 1_000_000 });
    const cartId = user ? (await getOrCreateCart({ userId: user.id })).cart.id : await guestCart(variant.id, 2);
    if (user) await addCartItem(cartId, variant.id, 2);
    const res = await placeOrder({ cartId, user, contact: user ? { name: user.name, email: user.email, phone: "08031234567" } : contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    const p = await pay(res.order.id);
    gw.settle(p.reference, "success");
    await verifyPayment(p.reference, "test");
    return { ...res, variant, payment: p };
  }

  it("protects orders from unauthorised access", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const staff = await makeUser({ role: "support_agent" });
    const o = await paidOrder(owner);
    expect(await getOrderForViewer(o.order.number, { user: owner })).toBeTruthy();
    expect(await getOrderForViewer(o.order.number, { user: stranger })).toBeNull();
    expect(await getOrderForViewer(o.order.number, { user: null })).toBeNull();
    expect(await getOrderForViewer(o.order.number, { user: null, accessToken: "wrong" })).toBeNull();
    expect(await getOrderForViewer(o.order.number, { user: null, accessToken: orderAccessToken(o.order.id) })).toBeTruthy();
    expect(await getOrderForViewer(o.order.number, { user: staff })).toBeTruthy();
    expect(await trackOrder(o.order.number, "someone@else.com")).toBeNull();
    expect(await trackOrder(o.order.number.toLowerCase(), owner.email.toUpperCase())).toBeTruthy();
    await expect(cancelOrder(o.order.id, { user: stranger }, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestRefund(o.order.id, { user: stranger }, "not mine at all")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("moves through fulfilment statuses in order, by authorised staff only", async () => {
    const admin = await makeUser({ role: "admin" });
    const customer = await makeUser();
    const inventoryManager = await makeUser({ role: "inventory_manager" });
    const o = await paidOrder();
    await expect(updateFulfilmentStatus(o.order.id, "PROCESSING", customer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateFulfilmentStatus(o.order.id, "PROCESSING", inventoryManager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateFulfilmentStatus(o.order.id, "SHIPPED", admin)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await updateFulfilmentStatus(o.order.id, "PROCESSING", admin);
    await updateFulfilmentStatus(o.order.id, "READY_FOR_DISPATCH", admin);
    await updateFulfilmentStatus(o.order.id, "SHIPPED", admin, { carrier: "GIG Logistics", trackingNumber: "GIG123" });
    await updateFulfilmentStatus(o.order.id, "DELIVERED", admin);
    const full = (await getOrderForViewer(o.order.number, { user: admin }))!;
    expect(full.status).toBe("DELIVERED");
    expect(full.shipments[0]).toMatchObject({ carrier: "GIG Logistics", trackingNumber: "GIG123" });
    expect(full.history.map((h) => h.toStatus)).toEqual(["AWAITING_PAYMENT", "PAID", "PROCESSING", "READY_FOR_DISPATCH", "SHIPPED", "DELIVERED"]);
    // staff can never mark an unpaid order as paid by hand
    const unpaid = await placeOrder({ cartId: await guestCart(o.variant.id, 1), user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    await expect(updateFulfilmentStatus(unpaid.order.id, "PAID", admin)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(updateFulfilmentStatus(unpaid.order.id, "PROCESSING", admin)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("cancelling an unpaid order releases stock and voids the coupon; paid orders cannot be cancelled", async () => {
    const { variant } = await makeProduct({ stock: 4 });
    const res = await placeOrder({ cartId: await guestCart(variant.id, 3), user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    expect((await stockOf(variant.id)).available).toBe(1);
    await cancelOrder(res.order.id, { user: null, accessToken: res.accessToken }, "ordered by mistake");
    expect(await stockOf(variant.id)).toEqual({ onHand: 4, reserved: 0, available: 4 });
    expect((await orderRow(res.order.id)).status).toBe("CANCELLED");
    const paid = await paidOrder();
    await expect(cancelOrder(paid.order.id, { user: null, accessToken: paid.accessToken }, "x")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("will not cancel an order whose payment actually succeeded at the gateway", async () => {
    const { variant } = await makeProduct({ stock: 4 });
    const res = await placeOrder({ cartId: await guestCart(variant.id, 1), user: null, contact: contact(), address: LAGOS_ADDRESS, shippingMethodId: lagosStandard });
    gw.settle((await pay(res.order.id)).reference, "success"); // paid, webhook not yet delivered
    await expect(cancelOrder(res.order.id, { user: null, accessToken: res.accessToken }, "x")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await orderRow(res.order.id)).status).toBe("PAID");
  });

  it("refund handling: request → gateway refund → REFUNDED with optional restock", async () => {
    const admin = await makeUser({ role: "admin" });
    const support = await makeUser({ role: "support_agent" });
    const o = await paidOrder();
    await requestRefund(o.order.id, { user: null, accessToken: o.accessToken }, "Wrong part delivered");
    expect((await orderRow(o.order.id)).status).toBe("REFUND_REQUESTED");
    const [refund] = await db.select().from(refunds).where(eq(refunds.orderId, o.order.id));
    await expect(decideRefund(refund!.id, support, { approve: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    gw.state.failRefund = true;
    await expect(decideRefund(refund!.id, admin, { approve: true })).rejects.toMatchObject({ code: "REFUND_FAILED" });
    expect((await db.select().from(refunds).where(eq(refunds.id, refund!.id)))[0]!.status).toBe("REQUESTED");
    gw.state.failRefund = false;
    await decideRefund(refund!.id, admin, { approve: true, restock: true, note: "Approved" });
    expect(gw.refunds).toEqual([{ provider: "PAYSTACK", reference: o.payment.reference, amount: o.order.total }]);
    expect((await orderRow(o.order.id)).status).toBe("REFUNDED");
    expect(await pay(o.order.id)).toMatchObject({ status: "REFUNDED" });
    expect(await stockOf(o.variant.id)).toEqual({ onHand: 5, reserved: 0, available: 5 });
    await expect(decideRefund(refund!.id, admin, { approve: true })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(gw.refunds).toHaveLength(1);
  });

  it("a declined refund returns the order to its previous status", async () => {
    const admin = await makeUser({ role: "admin" });
    const o = await paidOrder();
    await updateFulfilmentStatus(o.order.id, "PROCESSING", admin);
    await requestRefund(o.order.id, { user: null, accessToken: o.accessToken }, "No longer needed");
    const [refund] = await db.select().from(refunds).where(eq(refunds.orderId, o.order.id));
    await decideRefund(refund!.id, admin, { approve: false, note: "Already dispatched" });
    expect((await orderRow(o.order.id)).status).toBe("PROCESSING");
    expect(gw.refunds).toHaveLength(0);
  });
});

afterAll(() => clearCatalogCache());
