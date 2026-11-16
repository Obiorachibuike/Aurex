import { relations, sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * AUREX database schema (PostgreSQL).
 * Money is stored as integer minor units (kobo for NGN).
 */

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ───────────────────────────── Enums ───────────────────────────── */

export const orderStatus = pgEnum("order_status", [
  "PENDING",
  "AWAITING_PAYMENT",
  "PAID",
  "PROCESSING",
  "READY_FOR_DISPATCH",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUND_REQUESTED",
  "REFUNDED",
]);
export const paymentStatus = pgEnum("payment_status", ["PENDING", "SUCCESS", "FAILED", "ABANDONED", "REFUNDED"]);
export const paymentProvider = pgEnum("payment_provider", ["PAYSTACK", "FLUTTERWAVE"]);
export const productStatus = pgEnum("product_status", ["DRAFT", "ACTIVE", "ARCHIVED"]);
export const wholesaleStatus = pgEnum("wholesale_status", ["NONE", "PENDING", "APPROVED", "REJECTED"]);
export const movementType = pgEnum("inventory_movement_type", [
  "RECEIVE",
  "ADJUST",
  "RESERVE",
  "RELEASE",
  "SALE",
  "RETURN",
]);
export const inventoryState = pgEnum("order_inventory_state", ["RESERVED", "COMMITTED", "RELEASED"]);
export const refundStatus = pgEnum("refund_status", ["REQUESTED", "APPROVED", "PROCESSED", "REJECTED"]);
export const couponType = pgEnum("coupon_type", ["PERCENT", "FIXED", "FREE_SHIPPING"]);
export const reviewStatus = pgEnum("review_status", ["PENDING", "APPROVED", "REJECTED"]);
export const notificationStatus = pgEnum("notification_status", ["QUEUED", "SENT", "FAILED", "SKIPPED"]);
export const ticketStatus = pgEnum("ticket_status", ["OPEN", "IN_PROGRESS", "RESOLVED"]);
export const conversationStatus = pgEnum("ai_conversation_status", ["ACTIVE", "ESCALATED", "CLOSED"]);

/* ───────────────────── Identity & access control ───────────────────── */

export const roles = pgTable("roles", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isStaff: boolean("is_staff").notNull().default(false),
  createdAt: createdAt(),
});

export const permissions = pgTable("permissions", {
  id: id(),
  key: text("key").notNull().unique(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const customerGroups = pgTable("customer_groups", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    emailVerifiedAt: ts("email_verified_at"),
    isSuspended: boolean("is_suspended").notNull().default(false),
    lastLoginAt: ts("last_login_at"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), index("users_role_idx").on(t.roleId)],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("user_sessions_user_idx").on(t.userId), index("user_sessions_expires_idx").on(t.expiresAt)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["VERIFY_EMAIL", "RESET_PASSWORD"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId)],
);

export const customerProfiles = pgTable("customer_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  wholesaleStatus: wholesaleStatus("wholesale_status").notNull().default("NONE"),
  groupId: uuid("group_id").references(() => customerGroups.id, { onDelete: "set null" }),
  businessName: text("business_name"),
  preferences: jsonb("preferences").$type<CustomerPreferences>().notNull().default({}),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  updatedAt: updatedAt(),
});

export type CustomerPreferences = {
  preferredBrands?: string[];
  primaryDevice?: string;
  orderUpdatesByEmail?: boolean;
};

export const addresses = pgTable(
  "addresses",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label"),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    country: text("country").notNull().default("NG"),
    isDefault: boolean("is_default").notNull().default(false),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("addresses_user_idx").on(t.userId)],
);

/* ───────────────────────────── Catalogue ───────────────────────────── */

export const categories = pgTable(
  "categories",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    /** Search keywords used by catalogue search and the AI assistant, e.g. ["screen","display","lcd"]. */
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    parentId: uuid("parent_id"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

export const brands = pgTable("brands", {
  id: id(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const deviceModels = pgTable(
  "device_models",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    /** Canonical model name without the brand, e.g. "Galaxy A15 4G". */
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** Manufacturer model numbers, e.g. ["SM-A155F"]. */
    modelNumbers: text("model_numbers").array().notNull().default(sql`'{}'::text[]`),
    /** Other names customers use, e.g. ["A15 4G", "A15"]. Shared aliases signal ambiguity. */
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("device_models_brand_idx").on(t.brandId), uniqueIndex("device_models_brand_name_uq").on(t.brandId, t.name)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    specs: jsonb("specs").$type<Record<string, string>>().notNull().default({}),
    qualityGrade: text("quality_grade"),
    warrantyMonths: integer("warranty_months").notNull().default(0),
    warrantyInfo: text("warranty_info"),
    status: productStatus("status").notNull().default("DRAFT"),
    isFeatured: boolean("is_featured").notNull().default(false),
    /** Universal products (e.g. cables, tools) fit every device and have no compatibility rows. */
    isUniversal: boolean("is_universal").notNull().default(false),
    /** Demo seed data marker — demo rows can be purged before going live. */
    isDemo: boolean("is_demo").notNull().default(false),
    soldCount: integer("sold_count").notNull().default(0),
    ratingAvg: integer("rating_avg_x100").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_category_idx").on(t.categoryId),
    index("products_brand_idx").on(t.brandId),
    index("products_status_idx").on(t.status, t.deletedAt),
    index("products_featured_idx").on(t.isFeatured),
    index("products_sold_idx").on(t.soldCount),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt"),
    publicId: text("public_id"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("product_images_product_idx").on(t.productId, t.sortOrder)],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull().default("Standard"),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    retailPrice: integer("retail_price").notNull(),
    compareAtPrice: integer("compare_at_price"),
    wholesalePrice: integer("wholesale_price"),
    minWholesaleQty: integer("min_wholesale_qty").notNull().default(1),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("product_variants_product_idx").on(t.productId),
    check("variant_prices_positive", sql`${t.retailPrice} > 0 and (${t.wholesalePrice} is null or ${t.wholesalePrice} > 0)`),
    check("variant_min_wholesale_qty", sql`${t.minWholesaleQty} >= 1`),
  ],
);

export const productCompatibility = pgTable(
  "product_compatibility",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    deviceModelId: uuid("device_model_id")
      .notNull()
      .references(() => deviceModels.id, { onDelete: "cascade" }),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.productId, t.deviceModelId] }), index("product_compat_device_idx").on(t.deviceModelId)],
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    retailPrice: integer("retail_price").notNull(),
    wholesalePrice: integer("wholesale_price"),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("price_history_variant_idx").on(t.variantId, t.createdAt)],
);

/* ───────────────────────────── Inventory ───────────────────────────── */

export const inventory = pgTable(
  "inventory",
  {
    variantId: uuid("variant_id")
      .primaryKey()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
    lowStockNotifiedAt: ts("low_stock_notified_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("inventory_non_negative", sql`${t.onHand} >= 0 and ${t.reserved} >= 0`),
    check("inventory_reserved_lte_on_hand", sql`${t.reserved} <= ${t.onHand}`),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    type: movementType("type").notNull(),
    /** Signed change. RESERVE/RELEASE affect `reserved`; others affect `on_hand`. */
    quantity: integer("quantity").notNull(),
    orderId: uuid("order_id"),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("inventory_movements_variant_idx").on(t.variantId, t.createdAt), index("inventory_movements_order_idx").on(t.orderId)],
);

/* ─────────────────────── Carts & wishlists ─────────────────────── */

export const carts = pgTable(
  "carts",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** Hash of the guest cart cookie token. */
    tokenHash: text("token_hash").unique(),
    status: text("status", { enum: ["ACTIVE", "CONVERTED"] }).notNull().default("ACTIVE"),
    couponCode: text("coupon_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("carts_active_user_uq").on(t.userId).where(sql`${t.status} = 'ACTIVE'`)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: id(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cart_items_cart_variant_uq").on(t.cartId, t.variantId), check("cart_item_qty", sql`${t.quantity} > 0`)],
);

export const wishlists = pgTable("wishlists", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.wishlistId, t.productId] })],
);

/* ─────────────────── Coupons, shipping, orders ─────────────────── */

export const coupons = pgTable("coupons", {
  id: id(),
  code: text("code").notNull().unique(),
  description: text("description"),
  type: couponType("type").notNull(),
  /** PERCENT: whole percent (1-100). FIXED: minor units. FREE_SHIPPING: ignored. */
  value: integer("value").notNull().default(0),
  minSubtotal: integer("min_subtotal").notNull().default(0),
  maxDiscount: integer("max_discount"),
  usageLimit: integer("usage_limit"),
  perCustomerLimit: integer("per_customer_limit"),
  usedCount: integer("used_count").notNull().default(0),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  appliesToWholesale: boolean("applies_to_wholesale").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const shippingZones = pgTable("shipping_zones", {
  id: id(),
  name: text("name").notNull().unique(),
  /** Nigerian states covered. A zone with ["*"] is the fallback for all other states. */
  states: text("states").array().notNull().default(sql`'{}'::text[]`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const shippingMethods = pgTable(
  "shipping_methods",
  {
    id: id(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    provider: text("provider").notNull().default("manual"),
    baseFee: integer("base_fee").notNull(),
    perItemFee: integer("per_item_fee").notNull().default(0),
    freeAbove: integer("free_above"),
    etaMinDays: integer("eta_min_days").notNull(),
    etaMaxDays: integer("eta_max_days").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("shipping_methods_zone_idx").on(t.zoneId)],
);

export type AddressSnapshot = {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  country: string;
};

export type ShippingMethodSnapshot = {
  id: string;
  name: string;
  zone: string;
  provider: string;
  etaMinDays: number;
  etaMaxDays: number;
};

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: text("number").notNull().unique(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Hash of the secret that lets a guest view this order from their confirmation link. */
    accessTokenHash: text("access_token_hash").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    customerName: text("customer_name").notNull(),
    status: orderStatus("status").notNull().default("PENDING"),
    pricingTier: text("pricing_tier", { enum: ["RETAIL", "WHOLESALE"] }).notNull().default("RETAIL"),
    currency: text("currency").notNull().default("NGN"),
    subtotal: integer("subtotal").notNull(),
    discountTotal: integer("discount_total").notNull().default(0),
    shippingTotal: integer("shipping_total").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    total: integer("total").notNull(),
    couponCode: text("coupon_code"),
    shippingAddress: jsonb("shipping_address").$type<AddressSnapshot>().notNull(),
    shippingMethodId: uuid("shipping_method_id").references(() => shippingMethods.id, { onDelete: "set null" }),
    shippingMethod: jsonb("shipping_method").$type<ShippingMethodSnapshot>().notNull(),
    notes: text("notes"),
    source: text("source", { enum: ["WEB", "AI"] }).notNull().default("WEB"),
    conversationId: uuid("conversation_id"),
    inventoryState: inventoryState("inventory_state").notNull().default("RESERVED"),
    reservationExpiresAt: ts("reservation_expires_at"),
    paidAt: ts("paid_at"),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("orders_user_idx").on(t.userId, t.createdAt),
    index("orders_status_idx").on(t.status, t.createdAt),
    index("orders_email_idx").on(sql`lower(${t.email})`),
    index("orders_created_idx").on(t.createdAt),
    check("orders_total_non_negative", sql`${t.total} >= 0`),
  ],
);

/** Order items snapshot product data at purchase time so history survives catalogue changes. */
export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    productSlug: text("product_slug"),
    variantName: text("variant_name").notNull(),
    sku: text("sku").notNull(),
    imageUrl: text("image_url"),
    qualityGrade: text("quality_grade"),
    warrantyMonths: integer("warranty_months").notNull().default(0),
    unitPrice: integer("unit_price").notNull(),
    /** Retail list price at purchase time, kept for reporting on wholesale savings. */
    listPrice: integer("list_price").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotal: integer("line_total").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId), index("order_items_variant_idx").on(t.variantId)],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status").notNull(),
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("order_status_history_order_idx").on(t.orderId, t.createdAt)],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: id(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    amount: integer("amount").notNull(),
    /** Set when the order is cancelled unpaid so the redemption no longer counts. */
    voidedAt: ts("voided_at"),
    createdAt: createdAt(),
  },
  (t) => [index("coupon_redemptions_coupon_idx").on(t.couponId)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    provider: paymentProvider("provider").notNull(),
    reference: text("reference").notNull().unique(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: paymentStatus("status").notNull().default("PENDING"),
    authorizationUrl: text("authorization_url"),
    providerTransactionId: text("provider_transaction_id"),
    channel: text("channel"),
    failureReason: text("failure_reason"),
    expiresAt: ts("expires_at").notNull(),
    paidAt: ts("paid_at"),
    verifiedAt: ts("verified_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_order_idx").on(t.orderId), index("payments_status_idx").on(t.status, t.expiresAt)],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: id(),
    provider: paymentProvider("provider").notNull(),
    /** Deterministic key per provider event; the unique index makes webhook handling idempotent. */
    eventKey: text("event_key").notNull(),
    eventType: text("event_type").notNull(),
    reference: text("reference"),
    payload: jsonb("payload").notNull(),
    outcome: text("outcome"),
    processedAt: ts("processed_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payment_events_provider_key_uq").on(t.provider, t.eventKey), index("payment_events_reference_idx").on(t.reference)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("REQUESTED"),
    providerReference: text("provider_reference"),
    adminNote: text("admin_note"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    processedBy: uuid("processed_by").references(() => users.id, { onDelete: "set null" }),
    processedAt: ts("processed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("refunds_order_idx").on(t.orderId), index("refunds_status_idx").on(t.status)],
);

export const shipments = pgTable(
  "shipments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    shippedAt: ts("shipped_at"),
    deliveredAt: ts("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [index("shipments_order_idx").on(t.orderId)],
);

/* ─────────────────────── Reviews & wholesale ─────────────────────── */

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    isVerifiedPurchase: boolean("is_verified_purchase").notNull().default(false),
    status: reviewStatus("status").notNull().default("PENDING"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("reviews_product_idx").on(t.productId, t.status),
    uniqueIndex("reviews_product_user_uq").on(t.productId, t.userId),
    check("review_rating_range", sql`${t.rating} between 1 and 5`),
  ],
);

export const wholesaleApplications = pgTable(
  "wholesale_applications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessName: text("business_name").notNull(),
    businessType: text("business_type").notNull(),
    registrationNumber: text("registration_number"),
    phone: text("phone").notNull(),
    address: text("address").notNull(),
    state: text("state").notNull(),
    expectedMonthlyVolume: text("expected_monthly_volume"),
    notes: text("notes"),
    status: wholesaleStatus("status").notNull().default("PENDING"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewNote: text("review_note"),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("wholesale_applications_user_idx").on(t.userId), index("wholesale_applications_status_idx").on(t.status)],
);

/** Bulk/wholesale price rules. Narrowest scope wins ties; the lowest resulting price is used. */
export const wholesalePriceRules = pgTable(
  "wholesale_price_rules",
  {
    id: id(),
    name: text("name").notNull(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => customerGroups.id, { onDelete: "cascade" }),
    minQuantity: integer("min_quantity").notNull().default(1),
    /** FIXED: unit price in minor units. PERCENT_OFF: whole percent off the wholesale price. */
    priceType: text("price_type", { enum: ["FIXED", "PERCENT_OFF"] }).notNull(),
    value: integer("value").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("wholesale_rules_product_idx").on(t.productId), index("wholesale_rules_variant_idx").on(t.variantId)],
);

/* ─────────────────────── AI assistant & support ─────────────────────── */

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Hash of the browser chat-session cookie; isolates guest conversations. */
    sessionHash: text("session_hash").notNull(),
    status: conversationStatus("status").notNull().default("ACTIVE"),
    title: text("title"),
    /** Server-owned workflow state (never written by the model directly). */
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    hasUnresolved: boolean("has_unresolved").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_conversations_session_idx").on(t.sessionHash), index("ai_conversations_user_idx").on(t.userId), index("ai_conversations_updated_idx").on(t.updatedAt)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "tool", "agent"] }).notNull(),
    content: text("content").notNull().default(""),
    /** Structured UI cards built from tool results (products, cart, order, payment link). */
    attachments: jsonb("attachments").$type<unknown[]>().notNull().default([]),
    toolCalls: jsonb("tool_calls").$type<unknown[]>(),
    toolCallId: text("tool_call_id"),
    feedback: integer("feedback"),
    unresolved: boolean("unresolved").notNull().default(false),
    provider: text("provider"),
    model: text("model"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const aiToolExecutions = pgTable(
  "ai_tool_executions",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    status: text("status", { enum: ["OK", "DENIED", "INVALID", "ERROR"] }).notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_tool_exec_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    type: text("type", { enum: ["FAQ", "POLICY", "BUSINESS", "WHOLESALE"] }).notNull(),
    content: text("content").notNull(),
    isPublished: boolean("is_published").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL => sql`setweight(to_tsvector('english', ${knowledgeDocuments.title}), 'A') || setweight(to_tsvector('english', ${knowledgeDocuments.content}), 'B')`,
    ),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("knowledge_search_idx").using("gin", t.searchVector), index("knowledge_type_idx").on(t.type)],
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: id(),
    number: text("number").notNull().unique(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    source: text("source", { enum: ["CONTACT_FORM", "AI_ESCALATION", "ADMIN"] }).notNull().default("CONTACT_FORM"),
    status: ticketStatus("status").notNull().default("OPEN"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    internalNotes: text("internal_notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("support_tickets_status_idx").on(t.status, t.createdAt)],
);

/* ─────────────────── Notifications, audit, settings ─────────────────── */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    channel: text("channel", { enum: ["EMAIL", "WHATSAPP"] }).notNull().default("EMAIL"),
    recipient: text("recipient").notNull(),
    template: text("template").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: notificationStatus("status").notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** Prevents the same business event from notifying twice (e.g. duplicate webhooks). */
    dedupeKey: text("dedupe_key").unique(),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_status_idx").on(t.status, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt), index("audit_logs_entity_idx").on(t.entityType, t.entityId)],
);

export const storeSettings = pgTable("store_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: id(),
  email: text("email").notNull().unique(),
  createdAt: createdAt(),
});

/** Fixed-window counters for rate limiting when Redis is not configured. */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: ts("reset_at").notNull(),
});

/* ───────────────────────────── Relations ───────────────────────────── */

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  profile: one(customerProfiles, { fields: [users.id], references: [customerProfiles.userId] }),
  addresses: many(addresses),
  orders: many(orders),
}));
export const rolesRelations = relations(roles, ({ many }) => ({ permissions: many(rolePermissions) }));
export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));
export const customerProfilesRelations = relations(customerProfiles, ({ one }) => ({
  user: one(users, { fields: [customerProfiles.userId], references: [users.id] }),
  group: one(customerGroups, { fields: [customerProfiles.groupId], references: [customerGroups.id] }),
}));
export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}));
export const categoriesRelations = relations(categories, ({ many }) => ({ products: many(products) }));
export const brandsRelations = relations(brands, ({ many }) => ({ products: many(products), devices: many(deviceModels) }));
export const deviceModelsRelations = relations(deviceModels, ({ one, many }) => ({
  brand: one(brands, { fields: [deviceModels.brandId], references: [brands.id] }),
  compatibility: many(productCompatibility),
}));
export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  images: many(productImages),
  variants: many(productVariants),
  compatibility: many(productCompatibility),
  reviews: many(reviews),
}));
export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));
export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  inventory: one(inventory, { fields: [productVariants.id], references: [inventory.variantId] }),
}));
export const inventoryRelations = relations(inventory, ({ one }) => ({
  variant: one(productVariants, { fields: [inventory.variantId], references: [productVariants.id] }),
}));
export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  variant: one(productVariants, { fields: [inventoryMovements.variantId], references: [productVariants.id] }),
  actor: one(users, { fields: [inventoryMovements.actorId], references: [users.id] }),
}));
export const productCompatibilityRelations = relations(productCompatibility, ({ one }) => ({
  product: one(products, { fields: [productCompatibility.productId], references: [products.id] }),
  device: one(deviceModels, { fields: [productCompatibility.deviceModelId], references: [deviceModels.id] }),
}));
export const cartsRelations = relations(carts, ({ many }) => ({ items: many(cartItems) }));
export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, { fields: [cartItems.variantId], references: [productVariants.id] }),
}));
export const wishlistItemsRelations = relations(wishlistItems, ({ one }) => ({
  wishlist: one(wishlists, { fields: [wishlistItems.wishlistId], references: [wishlists.id] }),
  product: one(products, { fields: [wishlistItems.productId], references: [products.id] }),
}));
export const shippingZonesRelations = relations(shippingZones, ({ many }) => ({ methods: many(shippingMethods) }));
export const shippingMethodsRelations = relations(shippingMethods, ({ one }) => ({
  zone: one(shippingZones, { fields: [shippingMethods.zoneId], references: [shippingZones.id] }),
}));
export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  payments: many(payments),
  history: many(orderStatusHistory),
  shipments: many(shipments),
  refunds: many(refunds),
}));
export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));
export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
  order: one(orders, { fields: [orderStatusHistory.orderId], references: [orders.id] }),
  actor: one(users, { fields: [orderStatusHistory.actorId], references: [users.id] }),
}));
export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));
export const refundsRelations = relations(refunds, ({ one }) => ({
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
  payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }),
}));
export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, { fields: [shipments.orderId], references: [orders.id] }),
}));
export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, { fields: [reviews.productId], references: [products.id] }),
  user: one(users, { fields: [reviews.userId], references: [users.id] }),
}));
export const wholesaleApplicationsRelations = relations(wholesaleApplications, ({ one }) => ({
  user: one(users, { fields: [wholesaleApplications.userId], references: [users.id] }),
}));
export const aiConversationsRelations = relations(aiConversations, ({ one, many }) => ({
  user: one(users, { fields: [aiConversations.userId], references: [users.id] }),
  messages: many(aiMessages),
  toolExecutions: many(aiToolExecutions),
}));
export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, { fields: [aiMessages.conversationId], references: [aiConversations.id] }),
}));
export const aiToolExecutionsRelations = relations(aiToolExecutions, ({ one }) => ({
  conversation: one(aiConversations, { fields: [aiToolExecutions.conversationId], references: [aiConversations.id] }),
}));
export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  user: one(users, { fields: [supportTickets.userId], references: [users.id] }),
  assignee: one(users, { fields: [supportTickets.assignedTo], references: [users.id] }),
}));
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));
