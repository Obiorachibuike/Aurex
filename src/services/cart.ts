import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { cartItems, carts, couponRedemptions, coupons, inventory, productImages, productVariants, products } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { AppError, InsufficientStockError, NotFoundError } from "@/lib/errors";
import { listPriceRules } from "./catalog";
import { resolveUnitPrice, type PriceRule, type PricingContext, type PricingTier } from "./pricing";
import { getSetting } from "./settings";
import { computeTotals, evaluateCoupon, MAX_LINE_QUANTITY, type CouponEvaluation, type Totals } from "./totals";

export type CartLine = {
  variantId: string;
  productId: string;
  categoryId: string;
  slug: string;
  name: string;
  variantName: string;
  sku: string;
  imageUrl: string | null;
  qualityGrade: string | null;
  warrantyMonths: number;
  unitPrice: number;
  listPrice: number;
  quantity: number;
  lineTotal: number;
  available: number;
  purchasable: boolean;
  /** Customer-facing problem with this line (out of stock, discontinued…). */
  issue: string | null;
};

export type CartView = {
  id: string | null;
  lines: CartLine[];
  itemCount: number;
  tier: PricingTier;
  totals: Totals;
  coupon: { code: string; valid: boolean; message: string | null; freeShipping: boolean } | null;
  hasIssues: boolean;
};

export const EMPTY_CART: CartView = { id: null, lines: [], itemCount: 0, tier: "RETAIL", totals: { subtotal: 0, discountTotal: 0, shippingTotal: 0, taxTotal: 0, total: 0, itemCount: 0 }, coupon: null, hasIssues: false };

export type CartOwner = { userId?: string | null; guestToken?: string | null };

export async function findCart(owner: CartOwner, conn: DbOrTx = db) {
  if (owner.userId) {
    const [c] = await conn.select().from(carts).where(and(eq(carts.userId, owner.userId), eq(carts.status, "ACTIVE"))).limit(1);
    if (c) return c;
  }
  if (owner.guestToken) {
    const [c] = await conn.select().from(carts).where(and(eq(carts.tokenHash, sha256(owner.guestToken)), eq(carts.status, "ACTIVE"), isNull(carts.userId))).limit(1);
    if (c) return c;
  }
  return null;
}

/** Returns the owner's active cart, creating one if needed. `newGuestToken` must be stored in a cookie by the caller. */
export async function getOrCreateCart(owner: CartOwner): Promise<{ cart: typeof carts.$inferSelect; newGuestToken: string | null }> {
  const existing = await findCart(owner);
  if (existing) return { cart: existing, newGuestToken: null };
  if (owner.userId) {
    const [created] = await db.insert(carts).values({ userId: owner.userId }).onConflictDoNothing().returning();
    return { cart: created ?? (await findCart(owner))!, newGuestToken: null };
  }
  const token = randomToken();
  const [created] = await db.insert(carts).values({ tokenHash: sha256(token) }).returning();
  return { cart: created!, newGuestToken: token };
}

/** Moves a guest cart's items into the user's cart at login. */
export async function mergeGuestCart(guestToken: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [guest] = await tx.select().from(carts).where(and(eq(carts.tokenHash, sha256(guestToken)), eq(carts.status, "ACTIVE"), isNull(carts.userId))).for("update");
    if (!guest) return;
    const [mine] = await tx.select().from(carts).where(and(eq(carts.userId, userId), eq(carts.status, "ACTIVE")));
    if (!mine) {
      await tx.update(carts).set({ userId, tokenHash: null }).where(eq(carts.id, guest.id));
      return;
    }
    const items = await tx.select().from(cartItems).where(eq(cartItems.cartId, guest.id));
    for (const it of items) {
      await tx
        .insert(cartItems)
        .values({ cartId: mine.id, variantId: it.variantId, quantity: it.quantity })
        .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.variantId], set: { quantity: sql`least(${cartItems.quantity} + ${it.quantity}, ${MAX_LINE_QUANTITY})` } });
    }
    if (!mine.couponCode && guest.couponCode) await tx.update(carts).set({ couponCode: guest.couponCode }).where(eq(carts.id, mine.id));
    await tx.delete(carts).where(eq(carts.id, guest.id));
  });
}

async function loadVariant(variantId: string, conn: DbOrTx = db) {
  const [row] = await conn
    .select({ variant: productVariants, product: products, onHand: inventory.onHand, reserved: inventory.reserved })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(productVariants.id, variantId))
    .limit(1);
  if (!row || row.variant.deletedAt || !row.variant.isActive || row.product.deletedAt || row.product.status !== "ACTIVE") return null;
  return { ...row, available: Math.max(0, (row.onHand ?? 0) - (row.reserved ?? 0)) };
}

function assertQuantity(q: number) {
  if (!Number.isInteger(q) || q < 1 || q > MAX_LINE_QUANTITY) throw new AppError(`Quantity must be a whole number between 1 and ${MAX_LINE_QUANTITY}.`, "INVALID_QUANTITY");
}

/** Adds to the existing quantity. Refuses to exceed available stock. */
export async function addCartItem(cartId: string, variantId: string, quantity: number): Promise<{ quantity: number; productName: string }> {
  assertQuantity(quantity);
  const v = await loadVariant(variantId);
  if (!v) throw new NotFoundError("That product is no longer available.");
  const [existing] = await db.select().from(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)));
  const next = (existing?.quantity ?? 0) + quantity;
  if (next > v.available) throw new InsufficientStockError(v.product.name, v.available);
  assertQuantity(next);
  await db.insert(cartItems).values({ cartId, variantId, quantity: next }).onConflictDoUpdate({ target: [cartItems.cartId, cartItems.variantId], set: { quantity: next } });
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
  return { quantity: next, productName: v.product.name };
}

/** Sets an absolute quantity; 0 removes the line. */
export async function setCartItemQuantity(cartId: string, variantId: string, quantity: number): Promise<void> {
  if (quantity <= 0) {
    await db.delete(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)));
    return;
  }
  assertQuantity(quantity);
  const v = await loadVariant(variantId);
  if (!v) throw new NotFoundError("That product is no longer available.");
  if (quantity > v.available) throw new InsufficientStockError(v.product.name, v.available);
  const res = await db.update(cartItems).set({ quantity }).where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId))).returning();
  if (!res.length) throw new NotFoundError("That item is not in your cart.");
}

export async function removeCartItem(cartId: string, variantId: string): Promise<void> {
  await db.delete(cartItems).where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)));
}

export async function setCartCoupon(cartId: string, code: string | null): Promise<void> {
  await db.update(carts).set({ couponCode: code ? code.trim().toUpperCase().slice(0, 40) : null }).where(eq(carts.id, cartId));
}

/** Loads and prices every cart line on the server. Used by the cart UI, the AI tools and order creation. */
export async function loadCartLines(cartId: string, ctx: PricingContext, conn: DbOrTx = db, preloadedRules?: PriceRule[]): Promise<CartLine[]> {
  const rows = await conn
    .select({ item: cartItems, variant: productVariants, product: products, onHand: inventory.onHand, reserved: inventory.reserved })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.createdAt));
  if (!rows.length) return [];
  // Inside a transaction never borrow a second pooled connection (that can deadlock the pool under load).
  const images = await conn.select().from(productImages).where(inArray(productImages.productId, [...new Set(rows.map((r) => r.product.id))])).orderBy(asc(productImages.sortOrder));
  const rules = preloadedRules ?? (await listPriceRules());
  return rows.map(({ item, variant, product, onHand, reserved }) => {
    const available = Math.max(0, (onHand ?? 0) - (reserved ?? 0));
    const active = !variant.deletedAt && variant.isActive && !product.deletedAt && product.status === "ACTIVE";
    const price = resolveUnitPrice({ id: variant.id, productId: product.id, categoryId: product.categoryId, retailPrice: variant.retailPrice, wholesalePrice: variant.wholesalePrice, minWholesaleQty: variant.minWholesaleQty }, item.quantity, ctx, rules);
    const issue = !active ? "This product is no longer available." : available === 0 ? "Out of stock." : available < item.quantity ? `Only ${available} available.` : null;
    return {
      variantId: variant.id,
      productId: product.id,
      categoryId: product.categoryId,
      slug: product.slug,
      name: product.name,
      variantName: variant.name,
      sku: variant.sku,
      imageUrl: images.find((i) => i.productId === product.id)?.url ?? null,
      qualityGrade: product.qualityGrade,
      warrantyMonths: product.warrantyMonths,
      unitPrice: price.unitPrice,
      listPrice: price.listPrice,
      quantity: item.quantity,
      lineTotal: price.unitPrice * item.quantity,
      available,
      purchasable: active && available >= item.quantity,
      issue,
    };
  });
}

export async function evaluateCartCoupon(code: string | null | undefined, ctx: { subtotal: number; tier: PricingTier; userId?: string | null; email?: string | null }, conn: DbOrTx = db, lock = false): Promise<{ evaluation: CouponEvaluation; couponId: string | null }> {
  if (!code) return { evaluation: { valid: false, reason: "" }, couponId: null };
  const base = conn.select().from(coupons).where(sql`upper(${coupons.code}) = ${code.trim().toUpperCase()}`).limit(1);
  const [coupon] = lock ? await base.for("update") : await base;
  if (!coupon) return { evaluation: { valid: false, reason: "This discount code is not valid." }, couponId: null };
  let customerRedemptions = 0;
  if (coupon.perCustomerLimit !== null && (ctx.userId || ctx.email)) {
    const [r] = await conn
      .select({ n: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.couponId, coupon.id), isNull(couponRedemptions.voidedAt), ctx.userId ? sql`(${couponRedemptions.userId} = ${ctx.userId} or lower(${couponRedemptions.email}) = ${(ctx.email ?? "").toLowerCase()})` : sql`lower(${couponRedemptions.email}) = ${(ctx.email ?? "").toLowerCase()}`));
    customerRedemptions = r?.n ?? 0;
  }
  return { evaluation: evaluateCoupon(coupon, { subtotal: ctx.subtotal, tier: ctx.tier, customerRedemptions }), couponId: coupon.id };
}

export async function getCartView(cartId: string | null | undefined, ctx: PricingContext, who: { userId?: string | null; email?: string | null } = {}, shippingFee?: (c: { subtotal: number; itemCount: number; freeShipping: boolean }) => Promise<number>): Promise<CartView> {
  if (!cartId) return { ...EMPTY_CART, tier: ctx.tier };
  const [cart] = await db.select().from(carts).where(eq(carts.id, cartId)).limit(1);
  if (!cart || cart.status !== "ACTIVE") return { ...EMPTY_CART, tier: ctx.tier };
  const lines = await loadCartLines(cart.id, ctx);
  const base = computeTotals(lines);
  let coupon: CartView["coupon"] = null;
  let discount = 0;
  let freeShipping = false;
  if (cart.couponCode) {
    const { evaluation } = await evaluateCartCoupon(cart.couponCode, { subtotal: base.subtotal, tier: ctx.tier, ...who });
    if (evaluation.valid) {
      discount = evaluation.discount;
      freeShipping = evaluation.freeShipping;
      coupon = { code: cart.couponCode, valid: true, message: null, freeShipping };
    } else coupon = { code: cart.couponCode, valid: false, message: evaluation.reason, freeShipping: false };
  }
  const fee = shippingFee ? await shippingFee({ subtotal: base.subtotal, itemCount: base.itemCount, freeShipping }) : 0;
  const totals = computeTotals(lines, { discount, shippingFee: fee, tax: await getSetting("tax") });
  return { id: cart.id, lines, itemCount: totals.itemCount, tier: ctx.tier, totals, coupon, hasIssues: lines.some((l) => !l.purchasable) };
}
