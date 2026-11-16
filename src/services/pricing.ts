/**
 * Pricing rules (pure functions — no I/O).
 * The server is the only place prices are computed; clients and the AI never supply prices.
 */
export type PricingTier = "RETAIL" | "WHOLESALE";
export type PricingContext = { tier: PricingTier; groupId: string | null };
export const RETAIL_CONTEXT: PricingContext = { tier: "RETAIL", groupId: null };

export type PriceableVariant = {
  id: string;
  productId: string;
  categoryId: string;
  retailPrice: number;
  wholesalePrice: number | null;
  minWholesaleQty: number;
};

export type PriceRule = {
  id: string;
  productId: string | null;
  variantId: string | null;
  categoryId: string | null;
  groupId: string | null;
  minQuantity: number;
  priceType: "FIXED" | "PERCENT_OFF";
  value: number;
  isActive: boolean;
};

export type PriceResolution = {
  unitPrice: number;
  listPrice: number;
  appliedTier: PricingTier;
  appliedRuleId: string | null;
};

export function pricingContextFor(user: { wholesaleApproved: boolean; groupId: string | null } | null | undefined): PricingContext {
  return user?.wholesaleApproved ? { tier: "WHOLESALE", groupId: user.groupId } : RETAIL_CONTEXT;
}

function ruleApplies(rule: PriceRule, v: PriceableVariant, qty: number, ctx: PricingContext): boolean {
  if (!rule.isActive || qty < rule.minQuantity) return false;
  if (rule.groupId && rule.groupId !== ctx.groupId) return false;
  if (rule.variantId) return rule.variantId === v.id;
  if (rule.productId) return rule.productId === v.productId;
  if (rule.categoryId) return rule.categoryId === v.categoryId;
  return true; // store-wide rule
}

export function resolveUnitPrice(v: PriceableVariant, quantity: number, ctx: PricingContext, rules: PriceRule[] = []): PriceResolution {
  const listPrice = v.retailPrice;
  if (ctx.tier !== "WHOLESALE") return { unitPrice: listPrice, listPrice, appliedTier: "RETAIL", appliedRuleId: null };

  let best = listPrice;
  let appliedRuleId: string | null = null;
  if (v.wholesalePrice !== null && quantity >= v.minWholesaleQty) best = Math.min(best, v.wholesalePrice);

  const basis = v.wholesalePrice ?? v.retailPrice;
  for (const rule of rules) {
    if (!ruleApplies(rule, v, quantity, ctx)) continue;
    const price = rule.priceType === "FIXED" ? rule.value : Math.round((basis * (100 - Math.min(Math.max(rule.value, 0), 100))) / 100);
    if (price > 0 && price < best) {
      best = price;
      appliedRuleId = rule.id;
    }
  }
  return { unitPrice: best, listPrice, appliedTier: best < listPrice ? "WHOLESALE" : "RETAIL", appliedRuleId };
}

/** Quantity breaks to show approved wholesale buyers on a product page. */
export function wholesaleBreaks(v: PriceableVariant, ctx: PricingContext, rules: PriceRule[]): { minQuantity: number; unitPrice: number }[] {
  if (ctx.tier !== "WHOLESALE") return [];
  const points = new Set<number>();
  if (v.wholesalePrice !== null) points.add(v.minWholesaleQty);
  for (const r of rules) if (ruleApplies(r, v, Number.MAX_SAFE_INTEGER, ctx)) points.add(r.minQuantity);
  const out: { minQuantity: number; unitPrice: number }[] = [];
  for (const q of [...points].sort((a, b) => a - b)) {
    const price = resolveUnitPrice(v, q, ctx, rules).unitPrice;
    if (price < v.retailPrice && (out.length === 0 || price < out[out.length - 1]!.unitPrice)) out.push({ minQuantity: q, unitPrice: price });
  }
  return out;
}
