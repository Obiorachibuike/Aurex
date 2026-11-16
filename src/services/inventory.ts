import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { inventory, inventoryMovements, orderItems, orders, productVariants, products } from "@/db/schema";
import { env } from "@/lib/env";
import { AppError, InsufficientStockError } from "@/lib/errors";
import { queueNotification } from "./notifications";
import { getSetting } from "./settings";

type Line = { variantId: string; quantity: number; productName: string };

/**
 * Reserves stock for an order. Each reservation is a single conditional UPDATE, so two
 * concurrent checkouts can never reserve more than is available (no overselling).
 * Lines are processed in a stable order to avoid deadlocks.
 */
export async function reserveStock(tx: DbOrTx, lines: Line[], orderId: string): Promise<void> {
  for (const line of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    const updated = await tx
      .update(inventory)
      .set({ reserved: sql`${inventory.reserved} + ${line.quantity}` })
      .where(and(eq(inventory.variantId, line.variantId), sql`${inventory.onHand} - ${inventory.reserved} >= ${line.quantity}`))
      .returning({ variantId: inventory.variantId });
    if (!updated.length) {
      const [row] = await tx.select({ onHand: inventory.onHand, reserved: inventory.reserved }).from(inventory).where(eq(inventory.variantId, line.variantId));
      throw new InsufficientStockError(line.productName, Math.max(0, (row?.onHand ?? 0) - (row?.reserved ?? 0)));
    }
    await tx.insert(inventoryMovements).values({ variantId: line.variantId, type: "RESERVE", quantity: line.quantity, orderId, note: "Reserved for order" });
  }
}

async function orderLines(tx: DbOrTx, orderId: string) {
  return tx.select({ variantId: orderItems.variantId, productId: orderItems.productId, quantity: orderItems.quantity, productName: orderItems.productName, sku: orderItems.sku }).from(orderItems).where(eq(orderItems.orderId, orderId));
}

/** Converts a reservation into a sale after payment is verified. Caller must hold the order row lock. */
export async function commitReservation(tx: DbOrTx, orderId: string): Promise<void> {
  const lines = (await orderLines(tx, orderId)).sort((a, b) => (a.variantId ?? "").localeCompare(b.variantId ?? ""));
  for (const l of lines) {
    if (!l.variantId) continue;
    const [inv] = await tx
      .update(inventory)
      .set({ onHand: sql`${inventory.onHand} - ${l.quantity}`, reserved: sql`${inventory.reserved} - ${l.quantity}` })
      .where(eq(inventory.variantId, l.variantId))
      .returning();
    await tx.insert(inventoryMovements).values({ variantId: l.variantId, type: "SALE", quantity: -l.quantity, orderId, note: "Sold" });
    if (l.productId) await tx.update(products).set({ soldCount: sql`${products.soldCount} + ${l.quantity}` }).where(eq(products.id, l.productId));
    if (inv) await maybeNotifyLowStock(tx, inv, l.productName, l.sku);
  }
  await tx.update(orders).set({ inventoryState: "COMMITTED" }).where(eq(orders.id, orderId));
}

/** Returns reserved stock to the available pool (unpaid order cancelled or expired). */
export async function releaseReservation(tx: DbOrTx, orderId: string): Promise<void> {
  const lines = (await orderLines(tx, orderId)).sort((a, b) => (a.variantId ?? "").localeCompare(b.variantId ?? ""));
  for (const l of lines) {
    if (!l.variantId) continue;
    await tx.update(inventory).set({ reserved: sql`greatest(${inventory.reserved} - ${l.quantity}, 0)` }).where(eq(inventory.variantId, l.variantId));
    await tx.insert(inventoryMovements).values({ variantId: l.variantId, type: "RELEASE", quantity: -l.quantity, orderId, note: "Reservation released" });
  }
  await tx.update(orders).set({ inventoryState: "RELEASED" }).where(eq(orders.id, orderId));
}

/**
 * Payment arrived after the reservation was released. Takes stock directly if it is still
 * available; returns false (nothing changed) when any line cannot be fulfilled.
 */
export async function commitWithoutReservation(tx: DbOrTx, orderId: string): Promise<boolean> {
  const lines = (await orderLines(tx, orderId)).sort((a, b) => (a.variantId ?? "").localeCompare(b.variantId ?? ""));
  try {
    await tx.transaction(async (sp) => {
      for (const l of lines) {
        if (!l.variantId) throw new Error("variant removed");
        const res = await sp
          .update(inventory)
          .set({ onHand: sql`${inventory.onHand} - ${l.quantity}` })
          .where(and(eq(inventory.variantId, l.variantId), sql`${inventory.onHand} - ${inventory.reserved} >= ${l.quantity}`))
          .returning();
        if (!res.length) throw new Error("insufficient");
        await sp.insert(inventoryMovements).values({ variantId: l.variantId, type: "SALE", quantity: -l.quantity, orderId, note: "Sold (late payment)" });
        if (l.productId) await sp.update(products).set({ soldCount: sql`${products.soldCount} + ${l.quantity}` }).where(eq(products.id, l.productId));
      }
      await sp.update(orders).set({ inventoryState: "COMMITTED" }).where(eq(orders.id, orderId));
    });
    return true;
  } catch {
    return false;
  }
}

/** Puts sold stock back on the shelf (refund with returned goods). */
export async function restockOrder(tx: DbOrTx, orderId: string, actorId: string | null): Promise<void> {
  for (const l of await orderLines(tx, orderId)) {
    if (!l.variantId) continue;
    await tx.update(inventory).set({ onHand: sql`${inventory.onHand} + ${l.quantity}` }).where(eq(inventory.variantId, l.variantId));
    await tx.insert(inventoryMovements).values({ variantId: l.variantId, type: "RETURN", quantity: l.quantity, orderId, actorId, note: "Restocked after refund" });
    if (l.productId) await tx.update(products).set({ soldCount: sql`greatest(${products.soldCount} - ${l.quantity}, 0)` }).where(eq(products.id, l.productId));
  }
  await tx.update(orders).set({ inventoryState: "RELEASED" }).where(eq(orders.id, orderId));
}

async function maybeNotifyLowStock(tx: DbOrTx, inv: typeof inventory.$inferSelect, productName: string, sku: string) {
  const available = inv.onHand - inv.reserved;
  if (available > inv.lowStockThreshold) return;
  if (inv.lowStockNotifiedAt && Date.now() - inv.lowStockNotifiedAt.getTime() < 24 * 3600_000) return;
  const { lowStockEmail } = await getSetting("notifications", tx);
  await tx.update(inventory).set({ lowStockNotifiedAt: new Date() }).where(eq(inventory.variantId, inv.variantId));
  if (lowStockEmail) await queueNotification({ template: "low_stock_alert", recipient: lowStockEmail, payload: { productName, sku, available, threshold: inv.lowStockThreshold, url: `${env.appUrl}/admin/inventory?filter=low` } }, tx);
}

export async function adjustStock(input: { variantId: string; mode: "SET" | "DELTA"; value: number; note?: string; actorId: string | null; lowStockThreshold?: number }): Promise<typeof inventory.$inferSelect> {
  if (!Number.isInteger(input.value)) throw new AppError("Stock quantity must be a whole number.");
  return db.transaction(async (tx) => {
    await tx.insert(inventory).values({ variantId: input.variantId }).onConflictDoNothing();
    const [cur] = await tx.select().from(inventory).where(eq(inventory.variantId, input.variantId)).for("update");
    if (!cur) throw new AppError("Variant not found.", "NOT_FOUND", 404);
    const next = input.mode === "SET" ? input.value : cur.onHand + input.value;
    if (next < 0) throw new AppError("Stock cannot be negative.");
    if (next < cur.reserved) throw new AppError(`${cur.reserved} unit(s) are reserved by unpaid orders; stock cannot go below that.`);
    const delta = next - cur.onHand;
    const [row] = await tx
      .update(inventory)
      .set({ onHand: next, lowStockNotifiedAt: null, ...(input.lowStockThreshold !== undefined ? { lowStockThreshold: Math.max(0, input.lowStockThreshold) } : {}) })
      .where(eq(inventory.variantId, input.variantId))
      .returning();
    if (delta !== 0) await tx.insert(inventoryMovements).values({ variantId: input.variantId, type: delta > 0 && input.mode === "DELTA" ? "RECEIVE" : "ADJUST", quantity: delta, note: input.note ?? null, actorId: input.actorId });
    return row!;
  });
}

export async function getAvailability(variantId: string, conn: DbOrTx = db): Promise<{ available: number; onHand: number; reserved: number } | null> {
  const [row] = await conn
    .select({ onHand: inventory.onHand, reserved: inventory.reserved })
    .from(productVariants)
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(productVariants.id, variantId));
  if (!row) return null;
  const onHand = row.onHand ?? 0;
  const reserved = row.reserved ?? 0;
  return { onHand, reserved, available: Math.max(0, onHand - reserved) };
}
