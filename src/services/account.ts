import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { addresses, customerProfiles, newsletterSubscribers, orderItems, orders, products, reviews, supportTickets, users, wholesaleApplications, wishlistItems, wishlists } from "@/db/schema";
import { randomToken } from "@/lib/crypto";
import { AppError, NotFoundError } from "@/lib/errors";
import { normalizeNigerianPhone } from "@/lib/nigeria";
import { addressSchema, emailSchema, nameSchema, phoneSchema, stateSchema, type AddressInput } from "@/lib/validation";
import { audit } from "./audit";
import { getProductCards, clearCatalogCache } from "./catalog";
import { queueNotification } from "./notifications";
import type { PricingContext } from "./pricing";

/* ───────────────────────────── Profile ───────────────────────────── */

export const profileSchema = z.object({ name: nameSchema, phone: phoneSchema.optional().or(z.literal("")), marketingOptIn: z.boolean().default(false), orderUpdatesByEmail: z.boolean().default(true), primaryDevice: z.string().trim().max(80).optional() });
export async function updateProfile(userId: string, raw: z.input<typeof profileSchema>): Promise<void> {
  const v = profileSchema.parse(raw);
  const phone = v.phone ? normalizeNigerianPhone(v.phone) : null;
  await db.transaction(async (tx) => {
    await tx.update(users).set({ name: v.name, phone }).where(eq(users.id, userId));
    const prefs = { orderUpdatesByEmail: v.orderUpdatesByEmail, primaryDevice: v.primaryDevice || undefined };
    await tx.insert(customerProfiles).values({ userId, marketingOptIn: v.marketingOptIn, preferences: prefs }).onConflictDoUpdate({ target: customerProfiles.userId, set: { marketingOptIn: v.marketingOptIn, preferences: prefs } });
  });
}
export async function getProfile(userId: string) {
  const [row] = await db.select({ name: users.name, email: users.email, phone: users.phone, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt, profile: customerProfiles }).from(users).leftJoin(customerProfiles, eq(customerProfiles.userId, users.id)).where(eq(users.id, userId));
  return row ?? null;
}

/* ───────────────────────────── Addresses ───────────────────────────── */

export const listAddresses = (userId: string) => db.select().from(addresses).where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt))).orderBy(desc(addresses.isDefault), desc(addresses.createdAt));

export async function saveAddress(userId: string, raw: AddressInput & { label?: string; isDefault?: boolean }, id?: string): Promise<void> {
  const v = addressSchema.parse(raw);
  const phone = normalizeNigerianPhone(v.phone);
  if (!phone) throw new AppError("Enter a valid Nigerian phone number.", "INVALID_PHONE");
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: addresses.id }).from(addresses).where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt)));
    if (!id && existing.length >= 10) throw new AppError("You can save up to 10 addresses. Remove one to add another.", "ADDRESS_LIMIT");
    const makeDefault = raw.isDefault || existing.length === 0;
    if (makeDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
    const values = { fullName: v.fullName, phone, line1: v.line1, line2: v.line2 || null, city: v.city, state: v.state, label: raw.label?.trim().slice(0, 40) || null, ...(makeDefault ? { isDefault: true } : {}) };
    if (id) {
      // The userId condition is what stops one customer editing another's address.
      const [row] = await tx.update(addresses).set(values).where(and(eq(addresses.id, id), eq(addresses.userId, userId), isNull(addresses.deletedAt))).returning({ id: addresses.id });
      if (!row) throw new NotFoundError("Address not found.");
    } else await tx.insert(addresses).values({ ...values, userId });
  });
}
export async function deleteAddress(userId: string, id: string): Promise<void> {
  const [row] = await db.update(addresses).set({ deletedAt: new Date(), isDefault: false }).where(and(eq(addresses.id, id), eq(addresses.userId, userId), isNull(addresses.deletedAt))).returning({ id: addresses.id });
  if (!row) throw new NotFoundError("Address not found.");
}

/* ───────────────────────────── Wishlist ───────────────────────────── */

async function wishlistId(userId: string): Promise<string> {
  const [row] = await db.insert(wishlists).values({ userId }).onConflictDoUpdate({ target: wishlists.userId, set: { userId } }).returning({ id: wishlists.id });
  return row!.id;
}
/** Returns true when the product is now in the wishlist. */
export async function toggleWishlist(userId: string, productId: string): Promise<boolean> {
  const wid = await wishlistId(userId);
  const removed = await db.delete(wishlistItems).where(and(eq(wishlistItems.wishlistId, wid), eq(wishlistItems.productId, productId))).returning({ productId: wishlistItems.productId });
  if (removed.length) return false;
  const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.status, "ACTIVE"), isNull(products.deletedAt)));
  if (!p) throw new NotFoundError("Product not found.");
  await db.insert(wishlistItems).values({ wishlistId: wid, productId }).onConflictDoNothing();
  return true;
}
export async function wishlistProductIds(userId: string): Promise<string[]> {
  const rows = await db.select({ productId: wishlistItems.productId }).from(wishlistItems).innerJoin(wishlists, eq(wishlists.id, wishlistItems.wishlistId)).where(eq(wishlists.userId, userId)).orderBy(desc(wishlistItems.createdAt));
  return rows.map((r) => r.productId);
}
export async function getWishlist(userId: string, ctx: PricingContext) {
  return getProductCards(await wishlistProductIds(userId), ctx);
}

/* ───────────────────────────── Reviews ───────────────────────────── */

export const reviewSchema = z.object({ productId: z.string().uuid(), rating: z.coerce.number().int().min(1).max(5), title: z.string().trim().max(100).optional(), body: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(1500) });

export async function recomputeRating(productId: string): Promise<void> {
  await db.execute(sql`
    update products set
      rating_count = (select count(*) from reviews r where r.product_id = ${productId} and r.status = 'APPROVED'),
      rating_avg_x100 = coalesce((select round(avg(r.rating) * 100) from reviews r where r.product_id = ${productId} and r.status = 'APPROVED'), 0)
    where id = ${productId}`);
  clearCatalogCache();
}

/** Reviews are held for moderation. One review per customer per product; later submissions replace it. */
export async function submitReview(user: { id: string; name: string }, raw: z.input<typeof reviewSchema>): Promise<{ verified: boolean }> {
  const v = reviewSchema.parse(raw);
  const [bought] = await db.select({ id: orderItems.id }).from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId)).where(and(eq(orders.userId, user.id), eq(orderItems.productId, v.productId), sql`${orders.paidAt} is not null`)).limit(1);
  const values = { rating: v.rating, title: v.title || null, body: v.body, authorName: user.name.split(" ")[0] ?? "Customer", isVerifiedPurchase: !!bought, status: "PENDING" as const };
  await db.insert(reviews).values({ ...values, productId: v.productId, userId: user.id }).onConflictDoUpdate({ target: [reviews.productId, reviews.userId], set: values });
  await recomputeRating(v.productId);
  return { verified: !!bought };
}
export async function moderateReview(reviewId: string, status: "APPROVED" | "REJECTED", actorId: string): Promise<void> {
  const [row] = await db.update(reviews).set({ status }).where(eq(reviews.id, reviewId)).returning({ productId: reviews.productId });
  if (!row) throw new NotFoundError("Review not found.");
  await recomputeRating(row.productId);
  await audit({ actorId, action: `review.${status.toLowerCase()}`, entityType: "review", entityId: reviewId });
}
export const listReviewsAdmin = (status?: "PENDING" | "APPROVED" | "REJECTED") =>
  db.select({ review: reviews, product: products.name, slug: products.slug }).from(reviews).innerJoin(products, eq(products.id, reviews.productId)).where(status ? eq(reviews.status, status) : undefined).orderBy(desc(reviews.createdAt)).limit(200);

export async function latestReviews(limit = 6) {
  return db.select({ id: reviews.id, authorName: reviews.authorName, rating: reviews.rating, title: reviews.title, body: reviews.body, isVerifiedPurchase: reviews.isVerifiedPurchase, product: products.name, slug: products.slug })
    .from(reviews).innerJoin(products, eq(products.id, reviews.productId))
    .where(and(eq(reviews.status, "APPROVED"), eq(products.status, "ACTIVE"), isNull(products.deletedAt), sql`${reviews.rating} >= 4`)).orderBy(desc(reviews.createdAt)).limit(limit);
}

/* ───────────────────────────── Newsletter ───────────────────────────── */

export async function subscribeNewsletter(email: string): Promise<void> {
  await db.insert(newsletterSubscribers).values({ email: emailSchema.parse(email) }).onConflictDoNothing();
}

/* ───────────────────────── Wholesale applications ───────────────────────── */

export const wholesaleApplicationSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your business name").max(120),
  businessType: z.string().trim().min(2, "Select a business type").max(60),
  registrationNumber: z.string().trim().max(40).optional(),
  phone: phoneSchema,
  address: z.string().trim().min(5, "Enter your business address").max(250),
  state: stateSchema,
  expectedMonthlyVolume: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export async function applyForWholesale(userId: string, raw: z.input<typeof wholesaleApplicationSchema>): Promise<void> {
  const v = wholesaleApplicationSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [profile] = await tx.select().from(customerProfiles).where(eq(customerProfiles.userId, userId)).for("update");
    if (profile?.wholesaleStatus === "APPROVED") throw new AppError("Your wholesale account is already approved.", "ALREADY_APPROVED");
    if (profile?.wholesaleStatus === "PENDING") throw new AppError("Your application is already being reviewed.", "ALREADY_PENDING");
    await tx.insert(wholesaleApplications).values({ ...v, phone: normalizeNigerianPhone(v.phone) ?? v.phone, registrationNumber: v.registrationNumber || null, expectedMonthlyVolume: v.expectedMonthlyVolume || null, notes: v.notes || null, userId });
    await tx.insert(customerProfiles).values({ userId, wholesaleStatus: "PENDING", businessName: v.businessName }).onConflictDoUpdate({ target: customerProfiles.userId, set: { wholesaleStatus: "PENDING", businessName: v.businessName } });
  });
}
export const latestApplication = async (userId: string) => (await db.select().from(wholesaleApplications).where(eq(wholesaleApplications.userId, userId)).orderBy(desc(wholesaleApplications.createdAt)).limit(1))[0] ?? null;

/* ───────────────────────────── Support ───────────────────────────── */

export const contactSchema = z.object({ name: nameSchema, email: emailSchema, phone: z.string().trim().max(20).optional(), subject: z.string().trim().min(3, "Add a subject").max(150), message: z.string().trim().min(10, "Tell us how we can help").max(3000) });
export async function createSupportTicket(raw: z.input<typeof contactSchema>, userId: string | null): Promise<string> {
  const v = contactSchema.parse(raw);
  const number = `SUP-${randomToken(4).toUpperCase().replace(/[^A-Z0-9]/g, "X").slice(0, 6)}`;
  await db.transaction(async (tx) => {
    const [t] = await tx.insert(supportTickets).values({ number, userId, name: v.name, email: v.email, phone: v.phone || null, subject: v.subject, message: v.message, source: "CONTACT_FORM" }).returning({ id: supportTickets.id });
    await queueNotification({ template: "support_ticket", recipient: v.email, userId, payload: { ticketNumber: number, subject: v.subject, name: v.name }, dedupeKey: `ticket:${t!.id}` }, tx);
  });
  return number;
}
