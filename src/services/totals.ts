/** Cart arithmetic (pure functions). All amounts are integer minor units. */
import type { PricingTier } from "./pricing";

export const MAX_ORDER_TOTAL = 2_000_000_000; // ₦20m — keeps totals inside a 32-bit integer column
export const MAX_LINE_QUANTITY = 10_000;

export type CouponLike = {
  code: string;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  appliesToWholesale: boolean;
  isActive: boolean;
};

export type CouponEvaluation = { valid: true; discount: number; freeShipping: boolean; code: string } | { valid: false; reason: string };

export function evaluateCoupon(coupon: CouponLike | null | undefined, ctx: { subtotal: number; tier: PricingTier; customerRedemptions: number; now?: Date }): CouponEvaluation {
  if (!coupon || !coupon.isActive) return { valid: false, reason: "This discount code is not valid." };
  const now = ctx.now ?? new Date();
  if (coupon.startsAt && now < coupon.startsAt) return { valid: false, reason: "This discount code is not active yet." };
  if (coupon.endsAt && now > coupon.endsAt) return { valid: false, reason: "This discount code has expired." };
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return { valid: false, reason: "This discount code has reached its usage limit." };
  if (coupon.perCustomerLimit !== null && ctx.customerRedemptions >= coupon.perCustomerLimit) return { valid: false, reason: "You have already used this discount code." };
  if (ctx.tier === "WHOLESALE" && !coupon.appliesToWholesale) return { valid: false, reason: "This discount code cannot be combined with wholesale pricing." };
  if (ctx.subtotal < coupon.minSubtotal) return { valid: false, reason: `This code requires a minimum order of ₦${(coupon.minSubtotal / 100).toLocaleString("en-NG")}.` };
  if (coupon.type === "FREE_SHIPPING") return { valid: true, discount: 0, freeShipping: true, code: coupon.code };
  let discount = coupon.type === "PERCENT" ? Math.floor((ctx.subtotal * Math.min(Math.max(coupon.value, 0), 100)) / 100) : coupon.value;
  if (coupon.maxDiscount !== null) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.max(0, Math.min(discount, ctx.subtotal));
  return { valid: true, discount, freeShipping: false, code: coupon.code };
}

export type ShippingMethodLike = { baseFee: number; perItemFee: number; freeAbove: number | null };

export function computeShippingFee(method: ShippingMethodLike, ctx: { itemCount: number; subtotal: number; freeShipping?: boolean }): number {
  if (ctx.freeShipping) return 0;
  if (method.freeAbove !== null && ctx.subtotal >= method.freeAbove) return 0;
  return method.baseFee + method.perItemFee * Math.max(0, ctx.itemCount - 1);
}

export type ZoneLike = { id: string; states: string[]; isActive: boolean };

/** Exact state match wins; otherwise the wildcard ("*") zone is used. */
export function matchZone<Z extends ZoneLike>(zones: Z[], state: string): Z | null {
  const active = zones.filter((z) => z.isActive);
  const s = state.trim().toLowerCase();
  return active.find((z) => z.states.some((x) => x.toLowerCase() === s)) ?? active.find((z) => z.states.includes("*")) ?? null;
}

export type TaxConfig = { ratePercent: number; pricesIncludeTax: boolean };
export type Totals = { subtotal: number; discountTotal: number; shippingTotal: number; taxTotal: number; total: number; itemCount: number };

export function computeTotals(lines: { unitPrice: number; quantity: number }[], opts: { discount?: number; shippingFee?: number; tax?: TaxConfig } = {}): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const discountTotal = Math.max(0, Math.min(opts.discount ?? 0, subtotal));
  const shippingTotal = Math.max(0, opts.shippingFee ?? 0);
  const taxable = subtotal - discountTotal;
  const rate = Math.max(0, opts.tax?.ratePercent ?? 0);
  let taxTotal = 0;
  let total = taxable + shippingTotal;
  if (rate > 0) {
    if (opts.tax?.pricesIncludeTax ?? true) taxTotal = Math.round((taxable * rate) / (100 + rate));
    else {
      taxTotal = Math.round((taxable * rate) / 100);
      total += taxTotal;
    }
  }
  return { subtotal, discountTotal, shippingTotal, taxTotal, total, itemCount };
}
