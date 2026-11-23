import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { purchaseOrders, suppliers, warehouses } from "@/db/schema";
import { audit } from "./audit";

export async function listSuppliers() {
  return db.select().from(suppliers).orderBy(asc(suppliers.name));
}

export async function listWarehouses() {
  return db.select({
    id: warehouses.id, name: warehouses.name, code: warehouses.code, city: warehouses.city, state: warehouses.state, isActive: warehouses.isActive, isDefault: warehouses.isDefault,
    stockValue: sql<number>`coalesce((select sum(ws.on_hand::bigint * coalesce(pv.cost_price, pv.retail_price)) from warehouse_stock ws join product_variants pv on pv.id = ws.variant_id where ws.warehouse_id = ${warehouses.id}), 0)`,
  }).from(warehouses).orderBy(desc(warehouses.isDefault), asc(warehouses.name));
}

export async function listPurchaseOrders() {
  return db.select({ po: purchaseOrders, supplier: suppliers.name })
    .from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .orderBy(desc(purchaseOrders.createdAt)).limit(100);
}

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  paymentTerms: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createSupplier(raw: unknown, actorId: string | null) {
  const v = supplierSchema.parse(raw);
  const [row] = await db.insert(suppliers).values({
    name: v.name, contactName: v.contactName || null, email: v.email || null, phone: v.phone || null,
    address: v.address || null, leadTimeDays: v.leadTimeDays ?? null, paymentTerms: v.paymentTerms || null, notes: v.notes || null,
  }).returning();
  await audit({ actorId, action: "supplier.create", entityType: "supplier", entityId: row!.id, metadata: { name: v.name } });
  return row!;
}

const warehouseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  isDefault: z.boolean().optional(),
});

export async function createWarehouse(raw: unknown, actorId: string | null) {
  const v = warehouseSchema.parse(raw);
  if (v.isDefault) await db.update(warehouses).set({ isDefault: false }).where(eq(warehouses.isDefault, true));
  const [row] = await db.insert(warehouses).values({
    name: v.name, code: v.code.toUpperCase(), address: v.address || null, city: v.city || null, state: v.state || null, isDefault: !!v.isDefault,
  }).returning();
  await audit({ actorId, action: "warehouse.create", entityType: "warehouse", entityId: row!.id, metadata: { name: v.name, code: v.code } });
  return row!;
}
