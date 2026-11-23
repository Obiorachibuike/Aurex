import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { brands, categories, coupons, deviceModels, inventory, inventoryMovements, knowledgeDocuments, priceHistory, productCompatibility, productImages, productVariants, products, shippingMethods, shippingZones, wholesalePriceRules, customerGroups } from "@/db/schema";
import { AppError, NotFoundError } from "@/lib/errors";
import { NIGERIAN_STATES } from "@/lib/nigeria";
import { escapeLike, slugify } from "@/lib/utils";
import { audit } from "./audit";
import { clearCatalogCache } from "./catalog";

/* All money inputs are integer minor units (kobo); forms convert from naira before calling. */
const money = z.number().int().positive().max(2_000_000_000);
const optionalMoney = money.nullable().optional();

export const variantInputSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().trim().min(2, "SKU is required").max(60).regex(/^[A-Za-z0-9._-]+$/, "SKU may contain letters, numbers, dots, dashes and underscores only"),
  name: z.string().trim().min(1).max(80).default("Standard"),
  retailPrice: money,
  compareAtPrice: optionalMoney,
  wholesalePrice: optionalMoney,
  minWholesaleQty: z.number().int().min(1).max(10_000).default(1),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  lowStockThreshold: z.number().int().min(0).max(100_000).default(5),
});

const imageUrl = z.string().trim().max(600).refine((u) => u.startsWith("/") || /^https:\/\//.test(u), "Image must be an https URL or a local path");

export const productInputSchema = z
  .object({
    name: z.string().trim().min(3, "Product name is required").max(160),
    slug: z.string().trim().max(180).optional(),
    description: z.string().trim().max(8000).default(""),
    categoryId: z.string().uuid("Choose a category"),
    brandId: z.string().uuid().nullable().optional(),
    qualityGrade: z.string().trim().max(60).nullable().optional(),
    warrantyMonths: z.number().int().min(0).max(120).default(0),
    warrantyInfo: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
    isFeatured: z.boolean().default(false),
    isUniversal: z.boolean().default(false),
    specs: z.record(z.string().trim().min(1).max(60), z.string().trim().max(300)).default({}),
    images: z.array(z.object({ url: imageUrl, alt: z.string().trim().max(200).nullable().optional(), publicId: z.string().max(300).nullable().optional() })).max(12).default([]),
    deviceIds: z.array(z.union([z.string().uuid(), z.object({ deviceModelId: z.string().uuid(), confidence: z.enum(["VERIFIED", "MANUFACTURER", "SELLER", "AI_SUGGESTED", "UNCONFIRMED"]).default("UNCONFIRMED"), note: z.string().trim().max(300).nullable().optional() })])).max(500).default([]),
    variants: z.array(variantInputSchema).min(1, "Add at least one variant").max(30),
  })
  .superRefine((v, ctx) => {
    const skus = v.variants.map((x) => x.sku.toUpperCase());
    if (new Set(skus).size !== skus.length) ctx.addIssue({ code: "custom", message: "Each variant needs a different SKU", path: ["variants"] });
    v.variants.forEach((x, i) => {
      if (x.wholesalePrice && x.wholesalePrice > x.retailPrice) ctx.addIssue({ code: "custom", message: "Wholesale price cannot be higher than the retail price", path: ["variants", i, "wholesalePrice"] });
      if (x.compareAtPrice && x.compareAtPrice <= x.retailPrice) ctx.addIssue({ code: "custom", message: "The 'was' price must be higher than the selling price", path: ["variants", i, "compareAtPrice"] });
    });
  });
export type ProductInput = z.input<typeof productInputSchema>;

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || "product";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const [hit] = await db.select({ id: products.id }).from(products).where(and(eq(products.slug, candidate), excludeId ? ne(products.id, excludeId) : undefined));
    if (!hit) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

function translateUnique(e: unknown): never {
  const cause = (e as { cause?: { code?: string; constraint?: string } }).cause;
  if (cause?.code === "23505") {
    if (cause.constraint?.includes("sku")) throw new AppError("That SKU is already used by another product.", "DUPLICATE_SKU", 409);
    throw new AppError("A record with the same name or code already exists.", "DUPLICATE", 409);
  }
  throw e;
}

/** Creates or updates a product with its variants, images, compatibility and opening stock in one transaction. */
export async function saveProduct(raw: ProductInput, actorId: string | null, productId?: string): Promise<{ id: string; slug: string }> {
  const input = productInputSchema.parse(raw);
  const slug = await uniqueSlug(input.slug || input.name, productId);
  try {
    const result = await db.transaction(async (tx) => {
      const base = {
        name: input.name, slug, description: input.description, categoryId: input.categoryId, brandId: input.brandId ?? null,
        qualityGrade: input.qualityGrade || null, warrantyMonths: input.warrantyMonths, warrantyInfo: input.warrantyInfo || null,
        status: input.status, isFeatured: input.isFeatured, isUniversal: input.isUniversal, specs: input.specs,
      };
      let id = productId;
      if (id) {
        const [row] = await tx.update(products).set(base).where(and(eq(products.id, id), isNull(products.deletedAt))).returning({ id: products.id });
        if (!row) throw new NotFoundError("Product not found.");
      } else {
        const [row] = await tx.insert(products).values(base).returning({ id: products.id });
        id = row!.id;
      }

      await tx.delete(productImages).where(eq(productImages.productId, id));
      if (input.images.length) await tx.insert(productImages).values(input.images.map((im, i) => ({ productId: id!, url: im.url, alt: im.alt || input.name, publicId: im.publicId ?? null, sortOrder: i })));

      await tx.delete(productCompatibility).where(eq(productCompatibility.productId, id));
      const compatEntries = input.isUniversal ? [] : input.deviceIds.map((d) => typeof d === "string" ? { deviceModelId: d, confidence: "UNCONFIRMED" as const, note: null as string | null } : { deviceModelId: d.deviceModelId, confidence: d.confidence, note: d.note ?? null });
      const seen = new Set<string>();
      const deduped = compatEntries.filter((e) => { if (seen.has(e.deviceModelId)) return false; seen.add(e.deviceModelId); return true; });
      if (deduped.length) await tx.insert(productCompatibility).values(deduped.map((d) => ({ productId: id!, deviceModelId: d.deviceModelId, confidence: d.confidence, note: d.note, source: d.confidence === "AI_SUGGESTED" ? "ai" : "admin" })));

      const existing = await tx.select().from(productVariants).where(and(eq(productVariants.productId, id), isNull(productVariants.deletedAt)));
      const keep = new Set<string>();
      for (const [i, v] of input.variants.entries()) {
        const values = { sku: v.sku.toUpperCase(), name: v.name, retailPrice: v.retailPrice, compareAtPrice: v.compareAtPrice ?? null, wholesalePrice: v.wholesalePrice ?? null, minWholesaleQty: v.minWholesaleQty, isDefault: i === 0, isActive: true };
        const prev = v.id ? existing.find((e) => e.id === v.id) : undefined;
        let variantId: string;
        if (prev) {
          await tx.update(productVariants).set(values).where(eq(productVariants.id, prev.id));
          variantId = prev.id;
          if (prev.retailPrice !== values.retailPrice || prev.wholesalePrice !== values.wholesalePrice) {
            await tx.insert(priceHistory).values({ variantId, retailPrice: values.retailPrice, wholesalePrice: values.wholesalePrice, changedBy: actorId });
          }
          await tx.update(inventory).set({ lowStockThreshold: v.lowStockThreshold }).where(eq(inventory.variantId, variantId));
        } else {
          const [created] = await tx.insert(productVariants).values({ ...values, productId: id }).returning({ id: productVariants.id });
          variantId = created!.id;
          const opening = v.stock ?? 0;
          await tx.insert(inventory).values({ variantId, onHand: opening, lowStockThreshold: v.lowStockThreshold });
          if (opening > 0) await tx.insert(inventoryMovements).values({ variantId, type: "RECEIVE", quantity: opening, note: "Opening stock", actorId });
          await tx.insert(priceHistory).values({ variantId, retailPrice: values.retailPrice, wholesalePrice: values.wholesalePrice, changedBy: actorId });
        }
        keep.add(variantId);
      }
      // Variants removed from the form are soft-deleted so past orders keep their references.
      const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
      if (removed.length) await tx.update(productVariants).set({ deletedAt: new Date(), isActive: false, isDefault: false, sku: sql`${productVariants.sku} || '-DEL-' || substr(${productVariants.id}::text, 1, 8)` }).where(inArray(productVariants.id, removed));

      await audit({ actorId, action: productId ? "product.update" : "product.create", entityType: "product", entityId: id, metadata: { name: input.name, status: input.status, variants: input.variants.length } }, tx);
      return { id, slug };
    });
    clearCatalogCache();
    return result;
  } catch (e) {
    translateUnique(e);
  }
}

export async function setProductStatus(productId: string, status: "DRAFT" | "ACTIVE" | "ARCHIVED", actorId: string | null): Promise<void> {
  const [row] = await db.update(products).set({ status }).where(and(eq(products.id, productId), isNull(products.deletedAt))).returning({ id: products.id });
  if (!row) throw new NotFoundError("Product not found.");
  await audit({ actorId, action: `product.${status.toLowerCase()}`, entityType: "product", entityId: productId });
  clearCatalogCache();
}

/** Soft delete: the product disappears from the store and admin lists but order history is preserved. */
export async function deleteProduct(productId: string, actorId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.update(products).set({ deletedAt: new Date(), status: "ARCHIVED", slug: sql`${products.slug} || '-deleted-' || substr(${products.id}::text, 1, 8)` }).where(and(eq(products.id, productId), isNull(products.deletedAt))).returning({ id: products.id });
    if (!row) throw new NotFoundError("Product not found.");
    await tx.update(productVariants).set({ isActive: false }).where(eq(productVariants.productId, productId));
    await audit({ actorId, action: "product.delete", entityType: "product", entityId: productId }, tx);
  });
  clearCatalogCache();
}

export async function listProductsAdmin(filter: { q?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; categoryId?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(filter.pageSize ?? 25, 100);
  const page = Math.max(1, filter.page ?? 1);
  const q = filter.q?.trim();
  const where = and(
    isNull(products.deletedAt),
    filter.status ? eq(products.status, filter.status) : undefined,
    filter.categoryId ? eq(products.categoryId, filter.categoryId) : undefined,
    q ? or(ilike(products.name, `%${escapeLike(q)}%`), sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.sku ilike ${`%${escapeLike(q)}%`})`) : undefined,
  );
  const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(products).where(where);
  const rows = await db
    .select({
      id: products.id, name: products.name, slug: products.slug, status: products.status, isFeatured: products.isFeatured, isDemo: products.isDemo, soldCount: products.soldCount, updatedAt: products.updatedAt,
      category: categories.name,
      image: sql<string | null>`(select url from ${productImages} i where i.product_id = ${products.id} order by i.sort_order limit 1)`,
      sku: sql<string | null>`(select string_agg(v.sku, ', ' order by v.is_default desc) from ${productVariants} v where v.product_id = ${products.id} and v.deleted_at is null)`,
      minPrice: sql<number | null>`(select min(v.retail_price)::int from ${productVariants} v where v.product_id = ${products.id} and v.deleted_at is null)`,
      minWholesale: sql<number | null>`(select min(v.wholesale_price)::int from ${productVariants} v where v.product_id = ${products.id} and v.deleted_at is null)`,
      available: sql<number>`coalesce((select sum(greatest(inv.on_hand - inv.reserved, 0))::int from ${productVariants} v join ${inventory} inv on inv.variant_id = v.id where v.product_id = ${products.id} and v.deleted_at is null), 0)`,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(desc(products.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total: Number(count), page, pageSize, pageCount: Math.max(1, Math.ceil(Number(count) / pageSize)) };
}

export async function getProductForEdit(productId: string) {
  const row = await db.query.products.findFirst({
    where: and(eq(products.id, productId), isNull(products.deletedAt)),
    with: {
      images: { orderBy: (i, { asc: a }) => [a(i.sortOrder)] },
      variants: { where: isNull(productVariants.deletedAt), with: { inventory: true }, orderBy: (v, { desc: d, asc: a }) => [d(v.isDefault), a(v.createdAt)] },
      compatibility: true,
    },
  });
  return row ?? null;
}

/* ───────────── Taxonomy: categories, brands, device models ───────────── */

const csv = (s: string | undefined | null) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export const categorySchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).optional(), keywords: z.string().max(500).optional(), sortOrder: z.coerce.number().int().min(0).max(999).default(0), isActive: z.boolean().default(true) });
export async function saveCategory(raw: z.input<typeof categorySchema>, actorId: string | null, id?: string) {
  const v = categorySchema.parse(raw);
  const values = { name: v.name, description: v.description || null, keywords: csv(v.keywords).map((k) => k.toLowerCase()), sortOrder: v.sortOrder, isActive: v.isActive };
  try {
    if (id) await db.update(categories).set(values).where(eq(categories.id, id));
    else await db.insert(categories).values({ ...values, slug: slugify(v.name) });
  } catch (e) { translateUnique(e); }
  await audit({ actorId, action: id ? "category.update" : "category.create", entityType: "category", entityId: id ?? null, metadata: { name: v.name } });
  clearCatalogCache();
}

export const brandSchema = z.object({ name: z.string().trim().min(2).max(60), isActive: z.boolean().default(true) });
export async function saveBrand(raw: z.input<typeof brandSchema>, actorId: string | null, id?: string) {
  const v = brandSchema.parse(raw);
  try {
    if (id) await db.update(brands).set({ name: v.name, isActive: v.isActive }).where(eq(brands.id, id));
    else await db.insert(brands).values({ name: v.name, slug: slugify(v.name), isActive: v.isActive });
  } catch (e) { translateUnique(e); }
  await audit({ actorId, action: id ? "brand.update" : "brand.create", entityType: "brand", entityId: id ?? null, metadata: { name: v.name } });
  clearCatalogCache();
}

export const deviceSchema = z.object({ brandId: z.string().uuid("Choose a brand"), name: z.string().trim().min(2).max(80), modelNumbers: z.string().max(300).optional(), aliases: z.string().max(300).optional(), isActive: z.boolean().default(true) });
export async function saveDevice(raw: z.input<typeof deviceSchema>, actorId: string | null, id?: string) {
  const v = deviceSchema.parse(raw);
  const [brand] = await db.select().from(brands).where(eq(brands.id, v.brandId));
  if (!brand) throw new AppError("Choose a brand.", "INVALID", 400);
  const values = { brandId: v.brandId, name: v.name, modelNumbers: csv(v.modelNumbers).map((m) => m.toUpperCase()), aliases: csv(v.aliases), isActive: v.isActive };
  try {
    if (id) await db.update(deviceModels).set(values).where(eq(deviceModels.id, id));
    else await db.insert(deviceModels).values({ ...values, slug: slugify(`${brand.name} ${v.name}`) });
  } catch (e) { translateUnique(e); }
  await audit({ actorId, action: id ? "device.update" : "device.create", entityType: "device_model", entityId: id ?? null, metadata: { name: v.name } });
  clearCatalogCache();
}

export async function listTaxonomy() {
  const [cats, brs, devs, groups] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select().from(brands).orderBy(asc(brands.name)),
    db.select({ id: deviceModels.id, name: deviceModels.name, brandId: deviceModels.brandId, brand: brands.name, modelNumbers: deviceModels.modelNumbers, aliases: deviceModels.aliases, isActive: deviceModels.isActive }).from(deviceModels).innerJoin(brands, eq(brands.id, deviceModels.brandId)).orderBy(asc(brands.name), asc(deviceModels.name)),
    db.select().from(customerGroups).orderBy(asc(customerGroups.name)),
  ]);
  return { categories: cats, brands: brs, devices: devs, groups };
}

/* ───────────────────────────── Coupons ───────────────────────────── */

export const couponSchema = z
  .object({
    code: z.string().trim().toUpperCase().min(3).max(30).regex(/^[A-Z0-9_-]+$/, "Use letters, numbers, dashes or underscores"),
    description: z.string().trim().max(200).optional(),
    type: z.enum(["PERCENT", "FIXED", "FREE_SHIPPING"]),
    value: z.number().int().min(0).max(2_000_000_000).default(0),
    minSubtotal: z.number().int().min(0).default(0),
    maxDiscount: z.number().int().positive().nullable().optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
    perCustomerLimit: z.number().int().positive().nullable().optional(),
    startsAt: z.date().nullable().optional(),
    endsAt: z.date().nullable().optional(),
    appliesToWholesale: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === "PERCENT" && (v.value < 1 || v.value > 100)) ctx.addIssue({ code: "custom", message: "Percentage must be between 1 and 100", path: ["value"] });
    if (v.type === "FIXED" && v.value < 1) ctx.addIssue({ code: "custom", message: "Enter the discount amount", path: ["value"] });
    if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", message: "End date must be after the start date", path: ["endsAt"] });
  });
export async function saveCoupon(raw: z.input<typeof couponSchema>, actorId: string | null, id?: string) {
  const v = couponSchema.parse(raw);
  const values = { ...v, description: v.description || null, maxDiscount: v.maxDiscount ?? null, usageLimit: v.usageLimit ?? null, perCustomerLimit: v.perCustomerLimit ?? null, startsAt: v.startsAt ?? null, endsAt: v.endsAt ?? null };
  try {
    if (id) await db.update(coupons).set(values).where(eq(coupons.id, id));
    else await db.insert(coupons).values(values);
  } catch (e) { translateUnique(e); }
  await audit({ actorId, action: id ? "coupon.update" : "coupon.create", entityType: "coupon", entityId: id ?? null, metadata: { code: v.code } });
}
export const listCoupons = () => db.select().from(coupons).orderBy(desc(coupons.createdAt));

/* ───────────────────────────── Shipping ───────────────────────────── */

export const zoneSchema = z.object({ name: z.string().trim().min(2).max(80), states: z.array(z.string()).min(1, "Select at least one state"), isActive: z.boolean().default(true) }).refine((v) => v.states.every((s) => s === "*" || (NIGERIAN_STATES as readonly string[]).includes(s)), "Unknown state in list");
export async function saveZone(raw: z.input<typeof zoneSchema>, actorId: string | null, id?: string) {
  const v = zoneSchema.parse(raw);
  try {
    if (id) await db.update(shippingZones).set(v).where(eq(shippingZones.id, id));
    else await db.insert(shippingZones).values(v);
  } catch (e) { translateUnique(e); }
  await audit({ actorId, action: id ? "shipping_zone.update" : "shipping_zone.create", entityType: "shipping_zone", entityId: id ?? null, metadata: { name: v.name } });
}
export const methodSchema = z
  .object({ zoneId: z.string().uuid(), name: z.string().trim().min(2).max(80), description: z.string().trim().max(200).optional(), baseFee: z.number().int().min(0).max(100_000_000), perItemFee: z.number().int().min(0).max(10_000_000).default(0), freeAbove: z.number().int().positive().nullable().optional(), etaMinDays: z.number().int().min(0).max(60), etaMaxDays: z.number().int().min(0).max(90), isActive: z.boolean().default(true) })
  .refine((v) => v.etaMaxDays >= v.etaMinDays, { message: "Maximum days must not be less than minimum days", path: ["etaMaxDays"] });
export async function saveMethod(raw: z.input<typeof methodSchema>, actorId: string | null, id?: string) {
  const v = methodSchema.parse(raw);
  const values = { ...v, description: v.description || null, freeAbove: v.freeAbove ?? null };
  if (id) await db.update(shippingMethods).set(values).where(eq(shippingMethods.id, id));
  else await db.insert(shippingMethods).values(values);
  await audit({ actorId, action: id ? "shipping_method.update" : "shipping_method.create", entityType: "shipping_method", entityId: id ?? null, metadata: { name: v.name, baseFee: v.baseFee } });
}
export async function listShipping() {
  return db.query.shippingZones.findMany({ with: { methods: { orderBy: (m, { asc: a }) => [a(m.baseFee)] } }, orderBy: (z2, { asc: a }) => [a(z2.createdAt)] });
}

/* ─────────────────────── Wholesale price rules ─────────────────────── */

export const ruleSchema = z
  .object({ name: z.string().trim().min(2).max(100), productId: z.string().uuid().nullable().optional(), categoryId: z.string().uuid().nullable().optional(), groupId: z.string().uuid().nullable().optional(), minQuantity: z.number().int().min(1).max(100_000), priceType: z.enum(["FIXED", "PERCENT_OFF"]), value: z.number().int().positive(), isActive: z.boolean().default(true) })
  .superRefine((v, ctx) => {
    if (v.priceType === "PERCENT_OFF" && v.value > 90) ctx.addIssue({ code: "custom", message: "Percentage off must be 90 or less", path: ["value"] });
    if (v.priceType === "FIXED" && !v.productId) ctx.addIssue({ code: "custom", message: "A fixed unit price needs a specific product", path: ["productId"] });
  });
export async function saveRule(raw: z.input<typeof ruleSchema>, actorId: string | null, id?: string) {
  const v = ruleSchema.parse(raw);
  const values = { ...v, productId: v.productId ?? null, categoryId: v.categoryId ?? null, groupId: v.groupId ?? null };
  if (id) await db.update(wholesalePriceRules).set(values).where(eq(wholesalePriceRules.id, id));
  else await db.insert(wholesalePriceRules).values(values);
  await audit({ actorId, action: id ? "price_rule.update" : "price_rule.create", entityType: "wholesale_price_rule", entityId: id ?? null, metadata: { name: v.name } });
  clearCatalogCache();
}
export async function deleteRule(id: string, actorId: string | null) {
  await db.delete(wholesalePriceRules).where(eq(wholesalePriceRules.id, id));
  await audit({ actorId, action: "price_rule.delete", entityType: "wholesale_price_rule", entityId: id });
  clearCatalogCache();
}
export async function listRules() {
  return db
    .select({ rule: wholesalePriceRules, product: products.name, category: categories.name, group: customerGroups.name })
    .from(wholesalePriceRules)
    .leftJoin(products, eq(products.id, wholesalePriceRules.productId))
    .leftJoin(categories, eq(categories.id, wholesalePriceRules.categoryId))
    .leftJoin(customerGroups, eq(customerGroups.id, wholesalePriceRules.groupId))
    .orderBy(desc(wholesalePriceRules.createdAt));
}
export async function saveGroup(name: string, description: string | null, actorId: string | null) {
  const n = z.string().trim().min(2).max(60).parse(name);
  try { await db.insert(customerGroups).values({ name: n, description }); } catch (e) { translateUnique(e); }
  await audit({ actorId, action: "customer_group.create", entityType: "customer_group", metadata: { name: n } });
}

/* ───────────────────────── Knowledge base ───────────────────────── */

export const knowledgeSchema = z.object({ title: z.string().trim().min(3).max(160), type: z.enum(["FAQ", "POLICY", "BUSINESS", "WHOLESALE"]), content: z.string().trim().min(10, "Add the content").max(20_000), isPublished: z.boolean().default(true), sortOrder: z.coerce.number().int().min(0).max(999).default(0) });
export async function saveKnowledge(raw: z.input<typeof knowledgeSchema>, actorId: string | null, id?: string) {
  const v = knowledgeSchema.parse(raw);
  if (id) await db.update(knowledgeDocuments).set({ ...v, updatedBy: actorId }).where(eq(knowledgeDocuments.id, id));
  else {
    let slug = `${v.type === "FAQ" ? "faq-" : ""}${slugify(v.title)}`.slice(0, 80);
    const [hit] = await db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments).where(eq(knowledgeDocuments.slug, slug));
    if (hit) slug = `${slug}-${Date.now().toString(36)}`;
    await db.insert(knowledgeDocuments).values({ ...v, slug, updatedBy: actorId });
  }
  await audit({ actorId, action: id ? "knowledge.update" : "knowledge.create", entityType: "knowledge_document", entityId: id ?? null, metadata: { title: v.title } });
}
/** Core policy pages (about, shipping, returns…) are linked from the site, so they can be unpublished but not deleted. */
export const PROTECTED_KNOWLEDGE = ["about", "shipping", "returns", "warranty", "privacy", "terms", "wholesale-policy"];
export async function deleteKnowledge(id: string, actorId: string | null) {
  const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));
  if (!doc) return;
  if (PROTECTED_KNOWLEDGE.includes(doc.slug)) throw new AppError("This page is linked from the website and cannot be deleted. Edit or unpublish it instead.", "PROTECTED", 400);
  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));
  await audit({ actorId, action: "knowledge.delete", entityType: "knowledge_document", entityId: id, metadata: { title: doc.title } });
}
export const listKnowledgeAdmin = () => db.select().from(knowledgeDocuments).orderBy(asc(knowledgeDocuments.type), asc(knowledgeDocuments.sortOrder), asc(knowledgeDocuments.title));
