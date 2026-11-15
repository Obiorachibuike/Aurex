import { and, eq, isNull } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.appUrl;
  const fixed = ["", "/products", "/wholesale", "/about", "/faq", "/contact", "/track", "/policies/shipping", "/policies/returns", "/policies/warranty", "/policies/privacy", "/policies/terms", "/policies/wholesale-policy"];
  const [prods, cats] = await Promise.all([
    db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).where(and(eq(products.status, "ACTIVE"), isNull(products.deletedAt))).limit(5000),
    db.select({ slug: categories.slug }).from(categories).where(eq(categories.isActive, true)),
  ]);
  return [
    ...fixed.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.6 })),
    ...cats.map((c) => ({ url: `${base}/products?category=${c.slug}`, changeFrequency: "daily" as const, priority: 0.7 })),
    ...prods.map((p) => ({ url: `${base}/products/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "daily" as const, priority: 0.8 })),
  ];
}
