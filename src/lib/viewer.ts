import { cookies } from "next/headers";
import { cache } from "react";
import { cookieOptions } from "@/lib/cookies";
import { randomToken } from "@/lib/crypto";
import { findCart, getCartView, getOrCreateCart, mergeGuestCart } from "@/services/cart";
import { pricingContextFor } from "@/services/pricing";
import { getCurrentUser } from "./auth/session";

export const CART_COOKIE = "aurex_cart";
export const CHAT_COOKIE = "aurex_chat";

/** The signed-in user (or null) and the pricing tier they are entitled to. */
export const getViewer = cache(async () => {
  const user = await getCurrentUser();
  return { user, pricing: pricingContextFor(user) };
});

/**
 * Resolves the visitor's cart id. With `create: true` (server actions / route handlers only)
 * a cart and its guest cookie are created when missing.
 */
export async function currentCartId(create = false): Promise<string | null> {
  const { user } = await getViewer();
  const jar = await cookies();
  const guestToken = jar.get(CART_COOKIE)?.value ?? null;
  const owner = user ? { userId: user.id } : { guestToken };
  if (!create) return (await findCart(owner))?.id ?? null;
  const { cart, newGuestToken } = await getOrCreateCart(owner);
  if (newGuestToken) jar.set(CART_COOKIE, newGuestToken, cookieOptions(60));
  return cart.id;
}

export const getCurrentCart = cache(async () => {
  const { user, pricing } = await getViewer();
  return getCartView(await currentCartId(false), pricing, { userId: user?.id, email: user?.email });
});

/** Called right after sign-in: moves the guest cart into the account and drops the guest cookie. */
export async function adoptGuestCart(userId: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (!token) return;
  await mergeGuestCart(token, userId);
  jar.delete(CART_COOKIE);
}

/** Opaque per-browser token that owns the AI conversation. Only call with create=true from route handlers. */
export async function chatSessionToken(create: boolean): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(CHAT_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{20,}$/.test(existing)) return existing;
  if (!create) return null;
  const token = randomToken();
  jar.set(CHAT_COOKIE, token, cookieOptions(30));
  return token;
}
