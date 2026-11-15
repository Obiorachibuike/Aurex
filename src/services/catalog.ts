import { and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, deviceModels, inventory, productCompatibility, productVariants, products, reviews, wholesalePriceRules } from "@/db/schema";
import { escapeLike } from "@/lib/utils";
import type { DeviceRecord, DeviceResolution } from "./compatibility";
import { resolveUnitPrice, wholesaleBreaks, type PriceRule, type PricingContext } from "./pricing";
import { parseQuery, type CategoryRecord } from "./query-parser";

/* ───────────── Reference data (short in-memory cache) ───────────── */

type Cached<T> = { at: number; value: T } | null;
let deviceCache: Cached<DeviceRecord[]> = null;
let categoryCache: Cached<CategoryRecord[]> = null;
let ruleCache: Cached<PriceRule[]> = null;
const REF_TTL = 30_000;

export function clearCatalogCache() {
  deviceCache = categoryCache = ruleCache = null;
}

export async function listDeviceRecords(): Promise<DeviceRecord[]> {
  if (deviceCache && Date.now() - deviceCache.at < REF_TTL) return deviceCache.value;
  const rows = await db
    .select({ id: deviceModels.id, name: deviceModels.name, modelNumbers: deviceModels.modelNumbers, aliases: deviceModels.aliases, brand: brands.name })
    .from(deviceModels)
    .innerJoin(brands, eq(brands.id, deviceModels.brandId))
    .where(eq(deviceModels.isActive, true))
    .orderBy(asc(brands.name), asc(deviceModels.name));
  deviceCache = { at: Date.now(), value: rows };
  return rows;
}

export async function listCategoryRecords(): Promise<CategoryRecord[]> {
  if (categoryCache && Date.now() - categoryCache.at < REF_TTL) return categoryCache.value;
  const rows = await db.select({ id: categories.id, name: categories.name, slug: categories.slug, keywords: categories.keywords }).from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.sortOrder), asc(categories.name));
  categoryCache = { at: Date.now(), value: rows };
  return rows;
}

export async function listPriceRules(): Promise<PriceRule[]> {
  if (ruleCache && Date.now() - ruleCache.at < REF_TTL) return ruleCache.value;
  const rows = await db.select().from(wholesalePriceRules).where(eq(wholesalePriceRules.isActive, true));
  ruleCache = { at: Date.now(), value: rows };
  return rows;
}

/* ───────────────────────────── DTOs ───────────────────────────── */

export type VariantView = {
  id: string;
  sku: string;
  name: string;
  attributes: Record<string, string>;
  /** Price this customer pays for a single unit. */
  price: number;
  compareAtPrice: number | null;
  available: number;
  inStock: boolean;
  isDefault: boolean;
  /** Present ONLY for approved wholesale customers. */
  wholesale?: { price: number; minQuantity: number; breaks: { minQuantity: number; unitPrice: number }[] };
};

export type ProductCardView = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  category: { name: string; slug: string };
  brand: string | null;
  qualityGrade: string | null;
  warrantyMonths: number;
  isUniversal: boolean;
  price: number;
  compareAtPrice: number | null;
  hasMultiplePrices: boolean;
  available: number;
  inStock: boolean;
  ratingAvg: number;
  ratingCount: number;
  defaultVariantId: string | null;
  variants: VariantView[];
  compatibleDevices: { id: string; label: string }[];
};

export type ProductDetailView = ProductCardView & {
  description: string;
  specs: Record<string, string>;
  warrantyInfo: string | null;
  images: { url: string; alt: string | null }[];
  categoryId: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  soldCount: number;
};

type Hydrated = Awaited<ReturnType<typeof hydrate>>[number];

async function hydrate(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.query.products.findMany({
    where: inArray(products.id, ids),
    with: {
      category: true,
      brand: true,
      images: { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
      variants: { where: and(eq(productVariants.isActive, true), isNull(productVariants.deletedAt)), with: { inventory: true }, orderBy: (v, { desc, asc }) => [desc(v.isDefault), asc(v.retailPrice)] },
      compatibility: { with: { device: { with: { brand: true } } } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((i) => byId.get(i)).filter((r): r is NonNullable<typeof r> => !!r);
}

function toVariantView(p: Hydrated, v: Hydrated["variants"][number], ctx: PricingContext, rules: PriceRule[]): VariantView {
  const available = Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0));
  const priceable = { id: v.id, productId: p.id, categoryId: p.categoryId, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice, minWholesaleQty: v.minWholesaleQty };
  const view: VariantView = {
    id: v.id,
    sku: v.sku,
    name: v.name,
    attributes: v.attributes,
    price: resolveUnitPrice(priceable, 1, ctx, rules).unitPrice,
    compareAtPrice: v.compareAtPrice && v.compareAtPrice > v.retailPrice ? v.compareAtPrice : null,
    available,
    inStock: available > 0,
    isDefault: v.isDefault,
  };
  if (ctx.tier === "WHOLESALE") {
    const breaks = wholesaleBreaks(priceable, ctx, rules);
    if (breaks.length) view.wholesale = { price: breaks[0]!.unitPrice, minQuantity: breaks[0]!.minQuantity, breaks };
  }
  return view;
}

function toCard(p: Hydrated, ctx: PricingContext, rules: PriceRule[]): ProductCardView {
  const variants = p.variants.map((v) => toVariantView(p, v, ctx, rules));
  const main = variants.find((v) => v.isDefault && v.inStock) ?? variants.find((v) => v.inStock) ?? variants[0];
  const prices = variants.map((v) => v.price);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    imageUrl: p.images[0]?.url ?? null,
    category: { name: p.category.name, slug: p.category.slug },
    brand: p.brand?.name ?? null,
    qualityGrade: p.qualityGrade,
    warrantyMonths: p.warrantyMonths,
    isUniversal: p.isUniversal,
    price: main?.price ?? 0,
    compareAtPrice: main?.compareAtPrice ?? null,
    hasMultiplePrices: new Set(prices).size > 1,
    available: variants.reduce((s, v) => s + v.available, 0),
    inStock: variants.some((v) => v.inStock),
    ratingAvg: p.ratingAvg / 100,
    ratingCount: p.ratingCount,
    defaultVariantId: main?.id ?? null,
    variants,
    compatibleDevices: p.compatibility.filter((c) => c.device.isActive).map((c) => ({ id: c.deviceModelId, label: `${c.device.brand.name} ${c.device.name}` })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/* ───────────────────────────── Search ───────────────────────────── */

export type ProductSearchInput = {
  q?: string;
  categorySlug?: string;
  brandSlug?: string;
  deviceId?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  featured?: boolean;
  onSale?: boolean;
  sort?: "popular" | "newest" | "price_asc" | "price_desc" | "relevance";
  page?: number;
  pageSize?: number;
};

export type ProductSearchResult = {
  items: ProductCardView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  device: DeviceResolution;
  matchedCategory: CategoryRecord | null;
};

const agg = () =>
  db
    .select({
      productId: productVariants.productId,
      minPrice: sql<number>`min(${productVariants.retailPrice})`.as("min_price"),
      available: sql<number>`coalesce(sum(greatest(${inventory.onHand} - ${inventory.reserved}, 0)), 0)`.as("available"),
      onSale: sql<boolean>`bool_or(${productVariants.compareAtPrice} > ${productVariants.retailPrice})`.as("on_sale"),
    })
    .from(productVariants)
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(and(eq(productVariants.isActive, true), isNull(productVariants.deletedAt)))
    .groupBy(productVariants.productId)
    .as("agg");

export async function searchProducts(input: ProductSearchInput, ctx: PricingContext): Promise<ProductSearchResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(48, Math.max(1, Math.floor(input.pageSize ?? 12)));
  const [devices, cats, rules] = await Promise.all([listDeviceRecords(), listCategoryRecords(), listPriceRules()]);

  const where: SQL[] = [eq(products.status, "ACTIVE"), isNull(products.deletedAt)];
  let device: DeviceResolution = { status: "none" };
  let matchedCategory: CategoryRecord | null = null;
  let deviceIds: string[] = [];

  if (input.deviceId) {
    const d = devices.find((x) => x.id === input.deviceId);
    if (d) {
      device = { status: "exact", device: d, matchedText: "" };
      deviceIds = [d.id];
    }
  }

  const q = input.q?.trim().slice(0, 120);
  if (q) {
    const parsed = parseQuery(q, devices, cats);
    if (device.status === "none" && parsed.device.status !== "none") {
      device = parsed.device;
      deviceIds = parsed.device.status === "exact" ? [parsed.device.device.id] : parsed.device.candidates.map((d) => d.id);
    }
    if (!input.categorySlug && parsed.category) {
      matchedCategory = parsed.category;
      where.push(eq(products.categoryId, parsed.category.id));
    }
    for (const term of parsed.terms.slice(0, 6)) {
      const like = `%${escapeLike(term)}%`;
      where.push(
        or(
          ilike(products.name, like),
          ilike(products.qualityGrade, like),
          ilike(products.description, like),
          exists(db.select({ x: sql`1` }).from(productVariants).where(and(eq(productVariants.productId, products.id), ilike(productVariants.sku, like)))),
          exists(db.select({ x: sql`1` }).from(brands).where(and(eq(brands.id, products.brandId), ilike(brands.name, like)))),
          exists(db.select({ x: sql`1` }).from(categories).where(and(eq(categories.id, products.categoryId), ilike(categories.name, like)))),
        )!,
      );
    }
  }

  if (deviceIds.length) {
    // Strict structural compatibility: only products linked to the device (or universal accessories).
    const compat = exists(db.select({ x: sql`1` }).from(productCompatibility).where(and(eq(productCompatibility.productId, products.id), inArray(productCompatibility.deviceModelId, deviceIds))));
    where.push(matchedCategory || input.categorySlug ? or(compat, eq(products.isUniversal, true))! : compat);
  }
  if (input.categorySlug) {
    const c = cats.find((x) => x.slug === input.categorySlug);
    where.push(c ? eq(products.categoryId, c.id) : sql`false`);
  }
  if (input.brandSlug) where.push(exists(db.select({ x: sql`1` }).from(brands).where(and(eq(brands.id, products.brandId), eq(brands.slug, input.brandSlug)))));
  if (input.featured) where.push(eq(products.isFeatured, true));

  const a = agg();
  if (input.minPrice !== undefined) where.push(gte(a.minPrice, input.minPrice));
  if (input.maxPrice !== undefined) where.push(lte(a.minPrice, input.maxPrice));
  if (input.inStockOnly) where.push(sql`${a.available} > 0`);
  if (input.onSale) where.push(sql`${a.onSale} is true`);

  const order: SQL[] =
    input.sort === "newest"
      ? [desc(products.createdAt)]
      : input.sort === "price_asc"
        ? [asc(a.minPrice)]
        : input.sort === "price_desc"
          ? [desc(a.minPrice)]
          : [sql`(${a.available} > 0) desc`, desc(products.soldCount), desc(products.isFeatured), asc(a.minPrice)];
  order.push(asc(products.id));

  const condition = and(...where);
  const [idRows, countRows] = await Promise.all([
    db.select({ id: products.id }).from(products).innerJoin(a, eq(a.productId, products.id)).where(condition).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(products).innerJoin(a, eq(a.productId, products.id)).where(condition),
  ]);
  const hydrated = await hydrate(idRows.map((r) => r.id));
  const total = countRows[0]?.n ?? 0;
  return { items: hydrated.map((p) => toCard(p, ctx, rules)), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)), device, matchedCategory };
}

export async function getProductCards(ids: string[], ctx: PricingContext): Promise<ProductCardView[]> {
  const [rows, rules] = await Promise.all([hydrate(ids), listPriceRules()]);
  return rows.filter((p) => p.status === "ACTIVE" && !p.deletedAt).map((p) => toCard(p, ctx, rules));
}

export async function getProductDetail(by: { slug: string } | { id: string }, ctx: PricingContext, opts: { includeInactive?: boolean } = {}): Promise<ProductDetailView | null> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(and("slug" in by ? eq(products.slug, by.slug) : eq(products.id, by.id), isNull(products.deletedAt), opts.includeInactive ? undefined : eq(products.status, "ACTIVE")))
    .limit(1);
  if (!row) return null;
  const [[p], rules] = await Promise.all([hydrate([row.id]), listPriceRules()]);
  if (!p) return null;
  return {
    ...toCard(p, ctx, rules),
    description: p.description,
    specs: p.specs,
    warrantyInfo: p.warrantyInfo,
    images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
    categoryId: p.categoryId,
    status: p.status,
    soldCount: p.soldCount,
  };
}

export async function getRelatedProducts(product: ProductDetailView, ctx: PricingContext, limit = 4): Promise<ProductCardView[]> {
  const deviceIds = product.compatibleDevices.map((d) => d.id);
  const sameDevice = deviceIds.length
    ? await db
        .selectDistinct({ id: products.id, sold: products.soldCount })
        .from(products)
        .innerJoin(productCompatibility, eq(productCompatibility.productId, products.id))
        .where(and(inArray(productCompatibility.deviceModelId, deviceIds), eq(products.status, "ACTIVE"), isNull(products.deletedAt), sql`${products.id} <> ${product.id}`))
        .orderBy(desc(products.soldCount))
        .limit(limit)
    : [];
  let ids = sameDevice.map((r) => r.id);
  if (ids.length < limit) {
    const more = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.categoryId, product.categoryId), eq(products.status, "ACTIVE"), isNull(products.deletedAt), sql`${products.id} <> ${product.id}`))
      .orderBy(desc(products.soldCount))
      .limit(limit * 2);
    ids = [...new Set([...ids, ...more.map((r) => r.id)])].slice(0, limit);
  }
  return getProductCards(ids, ctx);
}

export async function getProductReviews(productId: string, limit = 20) {
  return db
    .select({ id: reviews.id, authorName: reviews.authorName, rating: reviews.rating, title: reviews.title, body: reviews.body, isVerifiedPurchase: reviews.isVerifiedPurchase, createdAt: reviews.createdAt })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.status, "APPROVED")))
    .orderBy(desc(reviews.createdAt))
    .limit(limit);
}

export async function searchSuggestions(q: string): Promise<{ products: { name: string; slug: string }[]; devices: { id: string; label: string }[]; categories: { name: string; slug: string }[] }> {
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return { products: [], devices: [], categories: [] };
  const [devices, cats] = await Promise.all([listDeviceRecords(), listCategoryRecords()]);
  const n = term.toLowerCase();
  const tokens = n.split(/\s+/).filter(Boolean);
  const deviceHits = devices
    .filter((d) => {
      const hay = `${d.brand} ${d.name} ${d.aliases.join(" ")} ${d.modelNumbers.join(" ")}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, 5)
    .map((d) => ({ id: d.id, label: `${d.brand} ${d.name}` }));
  const like = `%${escapeLike(term)}%`;
  const prods = await db
    .select({ name: products.name, slug: products.slug })
    .from(products)
    .where(and(eq(products.status, "ACTIVE"), isNull(products.deletedAt), ilike(products.name, like)))
    .orderBy(desc(products.soldCount))
    .limit(6);
  return { products: prods, devices: deviceHits, categories: cats.filter((c) => c.name.toLowerCase().includes(n) || c.keywords.some((k) => k.toLowerCase().includes(n))).slice(0, 3).map((c) => ({ name: c.name, slug: c.slug })) };
}

export async function getFacets() {
  const [cats, brandRows, devices] = await Promise.all([
    listCategoryRecords(),
    db
      .selectDistinct({ name: brands.name, slug: brands.slug })
      .from(brands)
      .innerJoin(products, and(eq(products.brandId, brands.id), eq(products.status, "ACTIVE"), isNull(products.deletedAt)))
      .orderBy(asc(brands.name)),
    listDeviceRecords(),
  ]);
  return { categories: cats, brands: brandRows, devices: devices.map((d) => ({ id: d.id, label: `${d.brand} ${d.name}`, brand: d.brand })) };
}
