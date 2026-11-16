import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brands, categories, customerProfiles, deviceModels, inventory, productCompatibility, productVariants, products } from "@/db/schema";
import { randomToken } from "@/lib/crypto";
import { createUser, getUserContext, setUserRole, type SessionUser } from "@/services/auth";
import type { RoleKey } from "@/lib/auth/permissions";
import { clearCatalogCache } from "@/services/catalog";

export const uniq = (p = "t") => `${p}-${randomToken(5).replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

export async function makeUser(opts: { role?: RoleKey; wholesale?: boolean; groupId?: string } = {}): Promise<SessionUser> {
  const u = await createUser({ name: "Test User", email: `${uniq("user")}@example.com`, password: "Password12345", emailVerified: true, phone: "+2348031234567" });
  if (opts.role) await setUserRole(u.id, opts.role);
  if (opts.wholesale) await db.update(customerProfiles).set({ wholesaleStatus: "APPROVED", groupId: opts.groupId ?? null }).where(eq(customerProfiles.userId, u.id));
  return (await getUserContext(u.id))!;
}

export async function makeProduct(opts: { stock?: number; retail?: number; wholesale?: number | null; minQty?: number; category?: string; deviceLabels?: string[]; name?: string; status?: "ACTIVE" | "DRAFT" } = {}) {
  const [cat] = await db.select().from(categories).where(eq(categories.slug, opts.category ?? "tools"));
  const name = opts.name ?? `Test Part ${uniq()}`;
  const [product] = await db.insert(products).values({ name, slug: uniq("prod"), categoryId: cat!.id, status: opts.status ?? "ACTIVE", warrantyMonths: 3, qualityGrade: "Original" }).returning();
  const [variant] = await db.insert(productVariants).values({ productId: product!.id, sku: uniq("SKU").toUpperCase(), retailPrice: opts.retail ?? 1_000_000, wholesalePrice: opts.wholesale === undefined ? 800_000 : opts.wholesale, minWholesaleQty: opts.minQty ?? 5, isDefault: true }).returning();
  await db.insert(inventory).values({ variantId: variant!.id, onHand: opts.stock ?? 10 });
  if (opts.deviceLabels?.length) {
    const devs = await db.select({ id: deviceModels.id, name: deviceModels.name, brand: brands.name }).from(deviceModels).innerJoin(brands, eq(brands.id, deviceModels.brandId));
    for (const label of opts.deviceLabels) await db.insert(productCompatibility).values({ productId: product!.id, deviceModelId: devs.find((d) => `${d.brand} ${d.name}` === label)!.id });
  }
  clearCatalogCache();
  return { product: product!, variant: variant! };
}

export async function stockOf(variantId: string) {
  const [row] = await db.select().from(inventory).where(eq(inventory.variantId, variantId));
  return { onHand: row!.onHand, reserved: row!.reserved, available: row!.onHand - row!.reserved };
}

export const LAGOS_ADDRESS = { fullName: "Ada Obi", phone: "08031234567", line1: "12 Allen Avenue, Ikeja", city: "Ikeja", state: "Lagos" };
