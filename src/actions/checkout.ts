"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, str, type ActionState } from "@/lib/action";
import { getClientIp } from "@/lib/auth/session";
import { AppError, NotFoundError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { checkoutSchema, emailSchema, stateSchema, type CheckoutInput } from "@/lib/validation";
import { currentCartId, getViewer } from "@/lib/viewer";
import { getCartView } from "@/services/cart";
import { orderUrl } from "@/services/order-shared";
import { cancelOrder, getOrderForViewer, placeOrder, requestRefund, trackOrder } from "@/services/orders";
import { retryPayment, verifyPayment } from "@/services/payments";
import { getShippingOptions, type ShippingOption } from "@/services/shipping";

/** Live delivery options for the cart and destination state — fees are always computed on the server. */
export async function shippingOptionsAction(state: string): Promise<ActionState<{ options: ShippingOption[] }>> {
  return runAction(async () => {
    const s = stateSchema.parse(state);
    const { user, pricing } = await getViewer();
    const cart = await getCartView(await currentCartId(false), pricing, { userId: user?.id, email: user?.email });
    const options = await getShippingOptions({ state: s, itemCount: cart.itemCount, subtotal: cart.totals.subtotal - cart.totals.discountTotal, freeShipping: !!cart.coupon?.valid && cart.coupon.freeShipping });
    return { data: { options } };
  });
}

/**
 * Creates the order from the server-side cart (prices, stock, shipping and totals are all
 * recomputed — nothing monetary is accepted from the browser) and returns the gateway URL.
 */
export async function placeOrderAction(input: CheckoutInput): Promise<ActionState<{ redirectTo: string }>> {
  return runAction(async () => {
    await enforceRateLimit(`checkout:${await getClientIp()}`, 12, 600, "Too many checkout attempts. Please wait a few minutes and try again.");
    const v = checkoutSchema.parse(input);
    const { user } = await getViewer();
    const cartId = await currentCartId(false);
    if (!cartId) throw new AppError("Your cart is empty.", "CART_EMPTY");
    const result = await placeOrder({
      cartId,
      user,
      contact: { name: v.fullName, email: user?.email ?? v.email, phone: v.phone },
      address: { fullName: v.fullName, phone: v.phone, line1: v.line1, line2: v.line2 || null, city: v.city, state: v.state },
      shippingMethodId: v.shippingMethodId,
      notes: v.notes || null,
      provider: v.provider ?? null,
      source: "WEB",
      saveAddress: !!user && !!v.saveAddress,
    });
    revalidatePath("/", "layout");
    const page = orderUrl(result.order).replace(/^https?:\/\/[^/]+/, "");
    // If the gateway could not be reached the order still exists and can be paid from its page.
    return { data: { redirectTo: result.authorizationUrl ?? `${page}${page.includes("?") ? "&" : "?"}payment=unavailable` } };
  });
}

async function viewerFor(token: string | null) {
  const { user } = await getViewer();
  return { user, accessToken: token };
}

export async function retryPaymentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let url = "";
  const res = await runAction(async () => {
    await enforceRateLimit(`pay:${await getClientIp()}`, 10, 600);
    const order = await getOrderForViewer(str(fd, "number"), await viewerFor(str(fd, "t") || null));
    if (!order) throw new NotFoundError("Order not found.");
    const provider = z.enum(["PAYSTACK", "FLUTTERWAVE"]).optional().parse(str(fd, "provider") || undefined);
    url = (await retryPayment(order.id, provider)).authorizationUrl;
  });
  if (res.ok && url) redirect(url);
  return res;
}

/** "I have paid" button: asks the gateway directly. The order only changes if the gateway confirms it. */
export async function checkPaymentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    await enforceRateLimit(`verify:${await getClientIp()}`, 20, 600);
    const order = await getOrderForViewer(str(fd, "number"), await viewerFor(str(fd, "t") || null));
    if (!order) throw new NotFoundError("Order not found.");
    const pending = order.payments.find((p) => p.status === "PENDING");
    if (!pending) return { message: order.paidAt ? "Payment already confirmed." : "There is no payment in progress for this order." };
    const { outcome } = await verifyPayment(pending.reference, "customer_check");
    revalidatePath(`/orders/${order.number}`);
    if (outcome === "PAID" || outcome === "ALREADY_PAID") return { message: "Payment confirmed. Thank you!" };
    if (outcome === "PENDING") throw new AppError("We have not received confirmation from the payment provider yet. If you completed the payment, it will update automatically within a few minutes.", "PAYMENT_PENDING");
    throw new AppError("The payment provider reports that this payment was not completed. You can try again.", "PAYMENT_NOT_COMPLETED");
  });
}

export async function cancelOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await viewerFor(str(fd, "t") || null);
    const order = await getOrderForViewer(str(fd, "number"), viewer);
    if (!order) throw new NotFoundError("Order not found.");
    await cancelOrder(order.id, viewer, str(fd, "reason") || "Cancelled by customer");
    revalidatePath(`/orders/${order.number}`);
    return { message: "Your order has been cancelled." };
  });
}

export async function requestRefundAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const viewer = await viewerFor(str(fd, "t") || null);
    const order = await getOrderForViewer(str(fd, "number"), viewer);
    if (!order) throw new NotFoundError("Order not found.");
    const reason = z.string().trim().min(10, "Please tell us why you are requesting a refund (at least 10 characters).").max(1000).parse(str(fd, "reason"));
    await requestRefund(order.id, viewer, reason);
    revalidatePath(`/orders/${order.number}`);
    return { message: "Refund request submitted. Our team will review it shortly." };
  });
}

/** Guest order tracking by order number + checkout email. Grants a short-lived, order-specific view. */
export async function trackOrderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    await enforceRateLimit(`track:${await getClientIp()}`, 10, 600, "Too many tracking attempts. Please wait a few minutes.");
    const number = z.string().trim().min(6, "Enter your order number").max(30).parse(str(fd, "number"));
    const email = emailSchema.parse(str(fd, "email"));
    const order = await trackOrder(number, email);
    // One message for "no such order" and "wrong email" so order numbers cannot be probed.
    if (!order) throw new NotFoundError("We couldn't find an order with that number and email address. Please check both and try again.");
    target = orderUrl(order).replace(/^https?:\/\/[^/]+/, "");
  });
  if (res.ok && target) redirect(target);
  return res;
}
