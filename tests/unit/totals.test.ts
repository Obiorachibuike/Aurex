import { describe, expect, it } from "vitest";
import { computeShippingFee, computeTotals, evaluateCoupon, matchZone, type CouponLike } from "@/services/totals";

const coupon = (c: Partial<CouponLike>): CouponLike => ({ code: "X", type: "PERCENT", value: 10, minSubtotal: 0, maxDiscount: null, usageLimit: null, perCustomerLimit: null, usedCount: 0, startsAt: null, endsAt: null, appliesToWholesale: false, isActive: true, ...c });
const ctx = { subtotal: 100_000, tier: "RETAIL" as const, customerRedemptions: 0 };

describe("cart calculations", () => {
  it("sums lines, applies discount and shipping", () => {
    const t = computeTotals([{ unitPrice: 25_000, quantity: 2 }, { unitPrice: 10_000, quantity: 1 }], { discount: 6_000, shippingFee: 2_500 });
    expect(t).toEqual({ subtotal: 60_000, discountTotal: 6_000, shippingTotal: 2_500, taxTotal: 0, total: 56_500, itemCount: 3 });
  });
  it("never lets a discount exceed the subtotal", () => {
    expect(computeTotals([{ unitPrice: 1_000, quantity: 1 }], { discount: 5_000 }).total).toBe(0);
  });
  it("handles tax-inclusive prices (reported, not added)", () => {
    const t = computeTotals([{ unitPrice: 107_500, quantity: 1 }], { tax: { ratePercent: 7.5, pricesIncludeTax: true } });
    expect(t.taxTotal).toBe(7_500);
    expect(t.total).toBe(107_500);
  });
  it("adds tax on top for tax-exclusive prices, after discount, excluding shipping", () => {
    const t = computeTotals([{ unitPrice: 100_000, quantity: 1 }], { discount: 20_000, shippingFee: 3_000, tax: { ratePercent: 7.5, pricesIncludeTax: false } });
    expect(t.taxTotal).toBe(6_000);
    expect(t.total).toBe(80_000 + 6_000 + 3_000);
  });
});

describe("discount calculations", () => {
  it("percent coupon with a cap", () => {
    expect(evaluateCoupon(coupon({ value: 10 }), ctx)).toMatchObject({ valid: true, discount: 10_000 });
    expect(evaluateCoupon(coupon({ value: 10, maxDiscount: 4_000 }), ctx)).toMatchObject({ discount: 4_000 });
  });
  it("fixed coupon is limited to the subtotal", () => {
    expect(evaluateCoupon(coupon({ type: "FIXED", value: 500_000 }), ctx)).toMatchObject({ discount: 100_000 });
  });
  it("free-shipping coupon gives no money discount", () => {
    expect(evaluateCoupon(coupon({ type: "FREE_SHIPPING" }), ctx)).toMatchObject({ valid: true, discount: 0, freeShipping: true });
  });
  it("rejects inactive, expired, future, exhausted, already-used and below-minimum coupons", () => {
    const now = new Date("2026-06-01");
    expect(evaluateCoupon(null, ctx).valid).toBe(false);
    expect(evaluateCoupon(coupon({ isActive: false }), ctx).valid).toBe(false);
    expect(evaluateCoupon(coupon({ endsAt: new Date("2026-05-01") }), { ...ctx, now }).valid).toBe(false);
    expect(evaluateCoupon(coupon({ startsAt: new Date("2026-07-01") }), { ...ctx, now }).valid).toBe(false);
    expect(evaluateCoupon(coupon({ usageLimit: 5, usedCount: 5 }), ctx).valid).toBe(false);
    expect(evaluateCoupon(coupon({ perCustomerLimit: 1 }), { ...ctx, customerRedemptions: 1 }).valid).toBe(false);
    expect(evaluateCoupon(coupon({ minSubtotal: 200_000 }), ctx).valid).toBe(false);
  });
  it("does not stack retail coupons on wholesale pricing unless allowed", () => {
    expect(evaluateCoupon(coupon({}), { ...ctx, tier: "WHOLESALE" }).valid).toBe(false);
    expect(evaluateCoupon(coupon({ appliesToWholesale: true }), { ...ctx, tier: "WHOLESALE" }).valid).toBe(true);
  });
});

describe("shipping calculations", () => {
  const method = { baseFee: 400_000, perItemFee: 20_000, freeAbove: 15_000_000 };
  it("base fee plus per-additional-item fee", () => {
    expect(computeShippingFee(method, { itemCount: 1, subtotal: 100 })).toBe(400_000);
    expect(computeShippingFee(method, { itemCount: 4, subtotal: 100 })).toBe(460_000);
  });
  it("is free above the threshold or with a free-shipping coupon", () => {
    expect(computeShippingFee(method, { itemCount: 3, subtotal: 15_000_000 })).toBe(0);
    expect(computeShippingFee(method, { itemCount: 3, subtotal: 100, freeShipping: true })).toBe(0);
    expect(computeShippingFee({ ...method, freeAbove: null }, { itemCount: 1, subtotal: 99_999_999 })).toBe(400_000);
  });
  it("matches the zone for a state, falling back to the wildcard zone", () => {
    const zones = [{ id: "lagos", states: ["Lagos"], isActive: true }, { id: "sw", states: ["Oyo", "Ogun"], isActive: true }, { id: "rest", states: ["*"], isActive: true }, { id: "off", states: ["Kano"], isActive: false }];
    expect(matchZone(zones, "lagos")?.id).toBe("lagos");
    expect(matchZone(zones, "Ogun")?.id).toBe("sw");
    expect(matchZone(zones, "Kano")?.id).toBe("rest");
    expect(matchZone(zones.slice(0, 2), "Kano")).toBeNull();
  });
});
