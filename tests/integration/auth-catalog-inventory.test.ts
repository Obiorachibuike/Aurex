import { desc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db";
import { auditLogs, authTokens, categories, inventoryMovements, notifications, users } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { getInventoryReport, updateCustomer } from "@/services/admin";
import { getProductForEdit, saveProduct, setProductStatus } from "@/services/admin-catalog";
import { authenticate, changePassword, createSession, destroySession, getSessionUser, hasPermission, registerCustomer, requestPasswordReset, resetPassword, verifyEmail } from "@/services/auth";
import { getProductDetail, searchProducts } from "@/services/catalog";
import { adjustStock } from "@/services/inventory";
import { RETAIL_CONTEXT } from "@/services/pricing";
import { makeProduct, makeUser, stockOf, uniq } from "../helpers/fixtures";

afterAll(async () => {
  await closeDb();
});

const tokenFromEmail = async (recipient: string, template: string) => {
  const [n] = await db.select().from(notifications).where(eq(notifications.recipient, recipient)).orderBy(desc(notifications.createdAt));
  expect(n?.template).toBe(template);
  return new URL(String((n!.payload as { url: string }).url)).searchParams.get("token")!;
};

describe("registration, sign-in and sessions", () => {
  const email = `${uniq("reg")}@Example.com`;
  const password = "Str0ngPassword!";

  it("registers a customer with a hashed password and a verification email", async () => {
    const user = await registerCustomer({ name: "Ngozi Eze", email, password });
    expect(user.email).toBe(email.toLowerCase());
    expect(user.passwordHash).not.toContain(password);
    expect(user.emailVerifiedAt).toBeNull();
    const token = await tokenFromEmail(user.email, "welcome_verify");
    // Only a hash of the token is stored.
    const [row] = await db.select().from(authTokens).where(eq(authTokens.tokenHash, sha256(token)));
    expect(row).toBeTruthy();
    expect(await verifyEmail(token)).toBe(true);
    expect(await verifyEmail(token)).toBe(false); // single use
  });

  it("rejects a duplicate email regardless of letter case", async () => {
    await expect(registerCustomer({ name: "Someone Else", email: email.toUpperCase(), password })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("signs in with the right password only, with the same error for unknown accounts", async () => {
    expect((await authenticate(email, password)).email).toBe(email.toLowerCase());
    await expect(authenticate(email, "wrong-password")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(authenticate("nobody@example.com", password)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("creates a session that resolves to a customer without staff permissions, and can be revoked", async () => {
    const user = await authenticate(email, password);
    const { token } = await createSession(user.id);
    const session = await getSessionUser(token);
    expect(session?.roleKey).toBe("customer");
    expect(session?.isStaff).toBe(false);
    expect(hasPermission(session, "admin.access")).toBe(false);
    expect(session?.wholesaleApproved).toBe(false);
    expect(await getSessionUser("not-a-real-token")).toBeNull();
    await destroySession(token);
    expect(await getSessionUser(token)).toBeNull();
  });

  it("resets a password with a single-use token and signs out existing sessions", async () => {
    const user = await authenticate(email, password);
    const { token: sessionToken } = await createSession(user.id);
    await requestPasswordReset(email);
    const token = await tokenFromEmail(user.email, "password_reset");
    expect(await resetPassword(token, "An0therPassword!")).toBe(true);
    expect(await resetPassword(token, "ThirdPassw0rd!!")).toBe(false);
    expect(await getSessionUser(sessionToken)).toBeNull();
    await expect(authenticate(email, password)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await authenticate(email, "An0therPassword!");
    await expect(changePassword(user.id, "not-the-current", "Whatever12345!")).rejects.toBeTruthy();
  });

  it("does not reveal whether an email is registered when a reset is requested", async () => {
    await expect(requestPasswordReset("ghost@example.com")).resolves.toBeUndefined();
  });

  it("blocks suspended accounts and ends their sessions", async () => {
    const admin = await makeUser({ role: "super_admin" });
    const target = await makeUser();
    const { token } = await createSession(target.id);
    await updateCustomer(target.id, admin, { isSuspended: true });
    expect(await getSessionUser(token)).toBeNull();
    await expect(authenticate(target.email, "Password12345")).rejects.toMatchObject({ code: "SUSPENDED" });
  });

  it("lets only a super administrator change roles", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser();
    await expect(updateCustomer(target.id, admin, { role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateCustomer(target.id, target, { role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [after] = await db.select().from(users).where(eq(users.id, target.id));
    expect(after).toBeTruthy();
  });
});

describe("product creation and search", () => {
  const input = async (over: Record<string, unknown> = {}) => {
    const [cat] = await db.select().from(categories).where(eq(categories.slug, "batteries"));
    const tag = uniq("zq");
    return {
      tag,
      data: { name: `Volt ${tag} Battery`, description: "High capacity replacement battery.", categoryId: cat!.id, status: "ACTIVE" as const, warrantyMonths: 6, isUniversal: true,
        variants: [{ sku: `BAT-${tag}`.toUpperCase(), name: "Standard", retailPrice: 1_250_000, wholesalePrice: 1_000_000, minWholesaleQty: 5, stock: 9, lowStockThreshold: 2 }], ...over },
    };
  };

  it("creates a product with stock, an audit entry and an opening stock movement", async () => {
    const admin = await makeUser({ role: "admin" });
    const { data, tag } = await input();
    const saved = await saveProduct(data, admin.id);
    const p = await getProductForEdit(saved.id);
    expect(p?.variants[0]?.inventory?.onHand).toBe(9);
    expect(p?.slug).toContain(tag);
    const moves = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, p!.variants[0]!.id));
    expect(moves.reduce((n, m) => n + m.quantity, 0)).toBe(9);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, saved.id));
    expect(log?.actorId).toBe(admin.id);
  });

  it("finds the new product by name and by SKU, and hides wholesale prices from retail shoppers", async () => {
    const { data, tag } = await input();
    await saveProduct(data, null);
    const byName = await searchProducts({ q: `volt ${tag}` }, RETAIL_CONTEXT);
    expect(byName.items.map((i) => i.name)).toContain(data.name);
    const bySku = await searchProducts({ q: data.variants[0]!.sku }, RETAIL_CONTEXT);
    expect(bySku.items[0]?.name).toBe(data.name);
    expect(JSON.stringify(byName.items)).not.toContain("1000000");
    expect(JSON.stringify(byName.items)).not.toContain("wholesale");
  });

  it("keeps drafts and archived products out of the store", async () => {
    const { data, tag } = await input({ status: "DRAFT" });
    const saved = await saveProduct(data, null);
    expect((await searchProducts({ q: tag }, RETAIL_CONTEXT)).total).toBe(0);
    expect(await getProductDetail({ slug: saved.slug }, RETAIL_CONTEXT)).toBeNull();
    await setProductStatus(saved.id, "ACTIVE", null);
    expect((await searchProducts({ q: tag }, RETAIL_CONTEXT)).total).toBe(1);
    await setProductStatus(saved.id, "ARCHIVED", null);
    expect((await searchProducts({ q: tag }, RETAIL_CONTEXT)).total).toBe(0);
  });

  it("rejects invalid products: duplicate SKU, wholesale above retail, bad image URL", async () => {
    const first = await input();
    await saveProduct(first.data, null);
    const dup = await input();
    dup.data.variants[0]!.sku = first.data.variants[0]!.sku;
    await expect(saveProduct(dup.data, null)).rejects.toBeTruthy();
    const pricey = await input();
    pricey.data.variants[0]!.wholesalePrice = 9_999_999;
    await expect(saveProduct(pricey.data, null)).rejects.toBeTruthy();
    const img = await input({ images: [{ url: "javascript:alert(1)" }] });
    await expect(saveProduct(img.data, null)).rejects.toBeTruthy();
  });

  it("filters by compatible device and treats search text as data, not SQL", async () => {
    const tag = uniq("fit");
    await makeProduct({ name: `Frame ${tag} for A15 4G`, category: "housing", deviceLabels: ["Samsung Galaxy A15 4G"] });
    await makeProduct({ name: `Frame ${tag} for A15 5G`, category: "housing", deviceLabels: ["Samsung Galaxy A15 5G"] });
    const ambiguous = await searchProducts({ q: `${tag} a15` }, RETAIL_CONTEXT);
    expect(ambiguous.device.status).toBe("ambiguous");
    const exact = await searchProducts({ q: `${tag} galaxy a15 5g` }, RETAIL_CONTEXT);
    expect(exact.device.status).toBe("exact");
    expect(exact.items.map((i) => i.name)).toEqual([`Frame ${tag} for A15 5G`]);
    const hostile = await searchProducts({ q: `%' OR 1=1; drop table products; --` }, RETAIL_CONTEXT);
    expect(hostile.total).toBe(0);
    expect((await searchProducts({}, RETAIL_CONTEXT)).total).toBeGreaterThan(0);
  });
});

describe("inventory adjustments", () => {
  it("adds, removes and sets stock with a movement for each change", async () => {
    const admin = await makeUser({ role: "inventory_manager" });
    const { variant } = await makeProduct({ stock: 10 });
    await adjustStock({ variantId: variant.id, mode: "DELTA", value: 5, actorId: admin.id, note: "Delivery" });
    expect((await stockOf(variant.id)).onHand).toBe(15);
    await adjustStock({ variantId: variant.id, mode: "DELTA", value: -3, actorId: admin.id, note: "Damaged" });
    await adjustStock({ variantId: variant.id, mode: "SET", value: 20, actorId: admin.id, note: "Stock count" });
    expect((await stockOf(variant.id)).onHand).toBe(20);
    const moves = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, variant.id));
    expect(moves.map((m) => m.quantity).sort((a, b) => a - b)).toEqual([-3, 5, 8]);
    expect(moves.every((m) => m.actorId === admin.id)).toBe(true);
  });

  it("never lets stock go negative or below what unpaid orders have reserved", async () => {
    const { variant } = await makeProduct({ stock: 4 });
    await expect(adjustStock({ variantId: variant.id, mode: "DELTA", value: -5, actorId: null })).rejects.toBeTruthy();
    await expect(adjustStock({ variantId: variant.id, mode: "SET", value: -1, actorId: null })).rejects.toBeTruthy();
    expect((await stockOf(variant.id)).onHand).toBe(4);
  });

  it("reports low and out-of-stock items", async () => {
    const tag = uniq("inv");
    const low = await makeProduct({ stock: 2, name: `Low ${tag}` });
    const out = await makeProduct({ stock: 0, name: `Out ${tag}` });
    await makeProduct({ stock: 50, name: `Plenty ${tag}` });
    const lowReport = await getInventoryReport({ q: tag, view: "low" });
    expect(lowReport.rows.map((r) => r.variantId).sort()).toEqual([low.variant.id, out.variant.id].sort());
    const outReport = await getInventoryReport({ q: tag, view: "out" });
    expect(outReport.rows.map((r) => r.variantId)).toEqual([out.variant.id]);
    // An out-of-stock item is still listed in the store but cannot be bought.
    const found = await searchProducts({ q: `Out ${tag}` }, RETAIL_CONTEXT);
    expect(found.items[0]?.inStock).toBe(false);
    expect((await searchProducts({ q: `Out ${tag}`, inStockOnly: true }, RETAIL_CONTEXT)).total).toBe(0);
  });
});
