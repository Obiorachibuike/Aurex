import { describe, expect, it } from "vitest";
import { pricingContextFor, resolveUnitPrice, RETAIL_CONTEXT, wholesaleBreaks, type PriceRule, type PricingContext } from "@/services/pricing";

const variant = { id: "v1", productId: "p1", categoryId: "c1", retailPrice: 10_000, wholesalePrice: 8_000, minWholesaleQty: 5 };
const WHOLESALE: PricingContext = { tier: "WHOLESALE", groupId: "g1" };
const rule = (r: Partial<PriceRule>): PriceRule => ({ id: "r", productId: null, variantId: null, categoryId: null, groupId: null, minQuantity: 1, priceType: "PERCENT_OFF", value: 10, isActive: true, ...r });

describe("product pricing", () => {
  it("retail customers always pay the retail price, whatever the quantity", () => {
    expect(resolveUnitPrice(variant, 1, RETAIL_CONTEXT).unitPrice).toBe(10_000);
    expect(resolveUnitPrice(variant, 500, RETAIL_CONTEXT, [rule({ priceType: "FIXED", value: 1 })]).unitPrice).toBe(10_000);
  });
  it("only approved wholesale accounts get a wholesale pricing context", () => {
    expect(pricingContextFor(null).tier).toBe("RETAIL");
    expect(pricingContextFor({ wholesaleApproved: false, groupId: "g1" }).tier).toBe("RETAIL");
    expect(pricingContextFor({ wholesaleApproved: true, groupId: "g1" })).toEqual({ tier: "WHOLESALE", groupId: "g1" });
  });
});

describe("wholesale pricing", () => {
  it("applies the wholesale price only from the minimum wholesale quantity", () => {
    expect(resolveUnitPrice(variant, 4, WHOLESALE).unitPrice).toBe(10_000);
    const r = resolveUnitPrice(variant, 5, WHOLESALE);
    expect(r).toMatchObject({ unitPrice: 8_000, listPrice: 10_000, appliedTier: "WHOLESALE" });
  });
  it("falls back to retail when a variant has no wholesale price", () => {
    expect(resolveUnitPrice({ ...variant, wholesalePrice: null }, 100, WHOLESALE).unitPrice).toBe(10_000);
  });
  it("applies bulk rules: percent off the wholesale price at a quantity break", () => {
    const rules = [rule({ id: "bulk", minQuantity: 50, value: 5 })];
    expect(resolveUnitPrice(variant, 49, WHOLESALE, rules).unitPrice).toBe(8_000);
    expect(resolveUnitPrice(variant, 50, WHOLESALE, rules)).toMatchObject({ unitPrice: 7_600, appliedRuleId: "bulk" });
  });
  it("respects rule scope (variant, product, category) and customer group", () => {
    expect(resolveUnitPrice(variant, 10, WHOLESALE, [rule({ variantId: "other", priceType: "FIXED", value: 100 })]).unitPrice).toBe(8_000);
    expect(resolveUnitPrice(variant, 10, WHOLESALE, [rule({ categoryId: "c1", priceType: "FIXED", value: 7_000 })]).unitPrice).toBe(7_000);
    expect(resolveUnitPrice(variant, 10, WHOLESALE, [rule({ groupId: "g2", priceType: "FIXED", value: 100 })]).unitPrice).toBe(8_000);
    expect(resolveUnitPrice(variant, 10, WHOLESALE, [rule({ groupId: "g1", priceType: "FIXED", value: 6_500 })]).unitPrice).toBe(6_500);
  });
  it("picks the lowest applicable price and ignores inactive rules and non-positive prices", () => {
    const rules = [rule({ id: "a", priceType: "FIXED", value: 7_500 }), rule({ id: "b", priceType: "FIXED", value: 7_000 }), rule({ id: "c", priceType: "FIXED", value: 1, isActive: false }), rule({ id: "d", priceType: "FIXED", value: 0 })];
    expect(resolveUnitPrice(variant, 10, WHOLESALE, rules)).toMatchObject({ unitPrice: 7_000, appliedRuleId: "b" });
  });
  it("never charges a wholesale customer more than retail", () => {
    expect(resolveUnitPrice({ ...variant, wholesalePrice: 12_000 }, 10, WHOLESALE).unitPrice).toBe(10_000);
  });
  it("lists quantity breaks for wholesale buyers only", () => {
    const rules = [rule({ minQuantity: 50, value: 5 })];
    expect(wholesaleBreaks(variant, RETAIL_CONTEXT, rules)).toEqual([]);
    expect(wholesaleBreaks(variant, WHOLESALE, rules)).toEqual([{ minQuantity: 5, unitPrice: 8_000 }, { minQuantity: 50, unitPrice: 7_600 }]);
  });
});
