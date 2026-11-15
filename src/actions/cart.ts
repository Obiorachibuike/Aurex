"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { getClientIp } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { currentCartId, getViewer } from "@/lib/viewer";
import { addCartItem, getCartView, removeCartItem, setCartCoupon, setCartItemQuantity, type CartView } from "@/services/cart";

const id = z.string().uuid();
const qty = z.number().int().min(1).max(10_000);

async function view(cartId: string): Promise<CartView> {
  const { user, pricing } = await getViewer();
  return getCartView(cartId, pricing, { userId: user?.id, email: user?.email });
}
async function existingCart(): Promise<string> {
  const cartId = await currentCartId(false);
  if (!cartId) throw new NotFoundError("Your cart is empty.");
  return cartId;
}

export async function addToCartAction(variantId: string, quantity = 1): Promise<ActionState<{ itemCount: number }>> {
  return runAction(async () => {
    await enforceRateLimit(`cart:${await getClientIp()}`, 120, 60);
    const cartId = await currentCartId(true);
    const res = await addCartItem(cartId!, id.parse(variantId), qty.parse(quantity));
    const cart = await view(cartId!);
    revalidatePath("/", "layout");
    return { message: `${res.productName} added to your cart`, data: { itemCount: cart.itemCount } };
  });
}

export async function setQuantityAction(variantId: string, quantity: number): Promise<ActionState> {
  return runAction(async () => {
    const cartId = await existingCart();
    if (quantity <= 0) await removeCartItem(cartId, id.parse(variantId));
    else await setCartItemQuantity(cartId, id.parse(variantId), qty.parse(quantity));
    revalidatePath("/", "layout");
  });
}

export async function removeItemAction(variantId: string): Promise<ActionState> {
  return runAction(async () => {
    await removeCartItem(await existingCart(), id.parse(variantId));
    revalidatePath("/", "layout");
    return { message: "Item removed" };
  });
}

export async function applyCouponAction(code: string | null): Promise<ActionState> {
  return runAction(async () => {
    await enforceRateLimit(`coupon:${await getClientIp()}`, 15, 300, "Too many coupon attempts. Please wait a few minutes.");
    const cartId = await existingCart();
    const clean = code ? z.string().trim().min(2).max(40).parse(code).toUpperCase() : null;
    await setCartCoupon(cartId, clean);
    revalidatePath("/", "layout");
    if (!clean) return { message: "Coupon removed" };
    const cart = await view(cartId);
    if (cart.coupon && !cart.coupon.valid) {
      await setCartCoupon(cartId, null);
      throw new NotFoundError(cart.coupon.message ?? "That coupon cannot be applied to this order.");
    }
    return { message: `Coupon ${clean} applied` };
  });
}
