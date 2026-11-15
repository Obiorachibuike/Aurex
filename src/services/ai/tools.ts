import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { addresses, aiConversations, aiToolExecutions, supportTickets } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { reportError } from "@/lib/monitoring";
import { NIGERIAN_STATES, normalizeNigerianPhone, resolveState } from "@/lib/nigeria";
import { addCartItem, getCartView, removeCartItem, setCartItemQuantity, type CartView } from "../cart";
import { getProductCards, getProductDetail, listDeviceRecords, searchProducts, type ProductCardView } from "../catalog";
import { deviceLabel, resolveDevice } from "../compatibility";
import { getAvailability } from "../inventory";
import { queueNotification } from "../notifications";
import { orderUrl } from "../order-shared";
import { getOrderFull, ORDER_STATUS_LABELS, placeOrder } from "../orders";
import { pricingContextFor } from "../pricing";
import { getShippingOptions, quoteShipping } from "../shipping";
import type { ChatAttachment, LineAttachment, ProductAttachment, ToolContext, ToolResult } from "./types";

/**
 * AI tools: the ONLY way the assistant can read or change business data.
 * Every tool validates its input with zod, derives identity from the server-side context
 * (never from model arguments) and returns data computed by the normal business services.
 */

const uuid = z.string().uuid();
const qty = z.number().int().min(1).max(10_000);

function productAttachment(p: ProductCardView): ProductAttachment[] {
  const variants = p.variants.length > 1 ? p.variants : p.variants.slice(0, 1);
  return variants.map((v) => ({ productId: p.id, variantId: v.id, slug: p.slug, name: p.name, variantName: p.variants.length > 1 ? v.name : null, imageUrl: p.imageUrl, qualityGrade: v.attributes.Grade ?? p.qualityGrade, price: v.price, available: v.available, inStock: v.inStock, warrantyMonths: p.warrantyMonths }));
}

function productForModel(p: ProductCardView, wholesale: boolean) {
  return {
    product_id: p.id,
    name: p.name,
    category: p.category.name,
    quality_grade: p.qualityGrade,
    warranty_months: p.warrantyMonths,
    compatible_devices: p.isUniversal ? "universal" : p.compatibleDevices.map((d) => d.label),
    variants: p.variants.map((v) => ({ variant_id: v.id, name: v.name, sku: v.sku, unit_price_ngn: v.price / 100, in_stock: v.inStock, available_quantity: v.available, ...(wholesale && v.wholesale ? { wholesale_breaks: v.wholesale.breaks.map((b) => ({ min_quantity: b.minQuantity, unit_price_ngn: b.unitPrice / 100 })) } : {}) })),
  };
}

function cartLines(cart: CartView): LineAttachment[] {
  return cart.lines.map((l) => ({ variantId: l.variantId, name: l.name, variantName: l.variantName, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, imageUrl: l.imageUrl }));
}
function cartAttachment(cart: CartView): ChatAttachment {
  return { type: "cart", lines: cartLines(cart), subtotal: cart.totals.subtotal, itemCount: cart.itemCount };
}
function cartForModel(cart: CartView) {
  return {
    items: cart.lines.map((l) => ({ variant_id: l.variantId, name: l.name, variant: l.variantName, quantity: l.quantity, unit_price_ngn: l.unitPrice / 100, line_total_ngn: l.lineTotal / 100, issue: l.issue })),
    item_count: cart.itemCount,
    subtotal_ngn: cart.totals.subtotal / 100,
    discount_ngn: cart.totals.discountTotal / 100,
    coupon: cart.coupon?.valid ? cart.coupon.code : null,
  };
}

async function viewCart(ctx: ToolContext, create = false): Promise<CartView> {
  const cartId = await ctx.getCartId(create);
  return getCartView(cartId, pricingContextFor(ctx.user), { userId: ctx.user?.id, email: ctx.user?.email });
}

/** Any change to the cart invalidates a previously shown order summary. */
function invalidateQuote(ctx: ToolContext) {
  delete ctx.state.quote;
  delete ctx.state.confirmedHash;
}

const orderArgs = z.object({
  contact_name: z.string().trim().min(2).max(100).optional(),
  contact_email: z.string().trim().email().max(254).optional(),
  contact_phone: z.string().trim().max(30).optional(),
  address_id: uuid.optional().describe("Id of a saved address from get_customer_addresses (signed-in customers only)"),
  address_line1: z.string().trim().min(5).max(200).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  state: z.string().trim().max(40).optional().describe("Nigerian state, e.g. Lagos"),
  shipping_method_id: uuid.describe("Id from retrieve_shipping_options"),
});

type ToolDef<S extends z.ZodType> = {
  description: string;
  schema: S;
  /** Tools that change the cart or create orders are blocked when AI ordering is disabled. */
  ordering?: boolean;
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
};
const tool = <S extends z.ZodType>(def: ToolDef<S>) => def;

const ok = (data: unknown, attachments?: ChatAttachment[]): ToolResult => ({ ok: true, data, attachments, status: "OK" });
const denied = (message: string): ToolResult => ({ ok: false, data: { error: message }, status: "DENIED" });
const fail = (message: string): ToolResult => ({ ok: false, data: { error: message }, status: "ERROR" });

export const TOOLS = {
  search_products: tool({
    description: "Search the live AUREX catalogue. Use device_id (from check_product_compatibility) whenever the customer names a phone model, so only parts that truly fit are returned.",
    schema: z.object({ query: z.string().trim().max(120).optional().describe("Free text, e.g. 'battery' or 'A15 4G screen'"), device_id: uuid.optional(), category: z.string().trim().max(60).optional().describe("Category slug"), in_stock_only: z.boolean().optional() }),
    async run(a, ctx) {
      const pctx = pricingContextFor(ctx.user);
      const res = await searchProducts({ q: a.query, deviceId: a.device_id, categorySlug: a.category, inStockOnly: a.in_stock_only, pageSize: 6 }, pctx);
      if (res.device.status === "ambiguous") {
        return ok({ needs_clarification: true, message: "Several device models match. Ask the customer which one they have before recommending anything.", candidates: res.device.candidates.map((d) => ({ device_id: d.id, name: deviceLabel(d) })) }, [{ type: "options", options: res.device.candidates.map((d) => ({ label: deviceLabel(d), value: deviceLabel(d) })) }]);
      }
      const device = res.device.status === "exact" ? deviceLabel(res.device.device) : null;
      ctx.state.focus = { device, options: res.items.flatMap((p) => productAttachment(p).filter((x) => x.variantId).map((x) => ({ productId: p.id, variantId: x.variantId!, label: x.variantName ? `${p.name} (${x.variantName})` : p.name, grade: x.qualityGrade }))) };
      return ok({ device, total_found: res.total, products: res.items.map((p) => productForModel(p, pctx.tier === "WHOLESALE")) }, res.items.length ? [{ type: "products", device, items: res.items.flatMap(productAttachment) }] : undefined);
    },
  }),

  get_product_details: tool({
    description: "Get full live details of one product: description, specifications, quality grade, warranty, compatible devices, prices and stock.",
    schema: z.object({ product_id: uuid }),
    async run(a, ctx) {
      const pctx = pricingContextFor(ctx.user);
      const p = await getProductDetail({ id: a.product_id }, pctx);
      if (!p) return fail("Product not found.");
      return ok({ ...productForModel(p, pctx.tier === "WHOLESALE"), description: p.description, specifications: p.specs, warranty: p.warrantyInfo }, [{ type: "products", items: productAttachment(p) }]);
    },
  }),

  check_product_compatibility: tool({
    description: "Resolve a phone model the customer mentioned to AUREX device records, and optionally check whether a specific product fits it. Compatibility comes only from structured records — never guess from product names.",
    schema: z.object({ device: z.string().trim().min(1).max(80).describe("What the customer said, e.g. 'Samsung A15'"), product_id: uuid.optional() }),
    async run(a, ctx) {
      const res = resolveDevice(a.device, await listDeviceRecords());
      if (res.status === "none") return ok({ status: "unknown_device", message: "This device is not in the AUREX compatibility database. Do not recommend parts for it; offer human support." });
      if (res.status === "ambiguous") return ok({ status: "ambiguous", message: "Ask the customer which exact model they have.", candidates: res.candidates.map((d) => ({ device_id: d.id, name: deviceLabel(d), model_numbers: d.modelNumbers })) }, [{ type: "options", options: res.candidates.map((d) => ({ label: deviceLabel(d), value: deviceLabel(d) })) }]);
      const out: Record<string, unknown> = { status: "resolved", device_id: res.device.id, name: deviceLabel(res.device), model_numbers: res.device.modelNumbers };
      if (a.product_id) {
        const p = await getProductDetail({ id: a.product_id }, pricingContextFor(ctx.user));
        if (!p) return fail("Product not found.");
        out.product = p.name;
        out.compatible = p.isUniversal || p.compatibleDevices.some((d) => d.id === res.device.id);
      }
      return ok(out);
    },
  }),

  check_inventory: tool({
    description: "Check live stock for a product variant.",
    schema: z.object({ variant_id: uuid }),
    async run(a) {
      const inv = await getAvailability(a.variant_id);
      if (!inv) return fail("Variant not found.");
      return ok({ in_stock: inv.available > 0, available_quantity: inv.available });
    },
  }),

  get_product_price: tool({
    description: "Get the live unit price for a variant at a given quantity for THIS customer (wholesale prices only apply to approved wholesale accounts).",
    schema: z.object({ product_id: uuid, variant_id: uuid.optional(), quantity: qty.optional() }),
    async run(a, ctx) {
      const pctx = pricingContextFor(ctx.user);
      const [p] = await getProductCards([a.product_id], pctx);
      const v = p?.variants.find((x) => x.id === a.variant_id) ?? p?.variants[0];
      if (!p || !v) return fail("Product not found.");
      const q = a.quantity ?? 1;
      const unit = v.wholesale?.breaks.filter((b) => q >= b.minQuantity).pop()?.unitPrice ?? v.price;
      return ok({ product: p.name, variant: v.name, quantity: q, unit_price_ngn: unit / 100, line_total_ngn: (unit * q) / 100, pricing: pctx.tier === "WHOLESALE" ? "wholesale account" : "retail", ...(pctx.tier === "WHOLESALE" && v.wholesale ? { wholesale_breaks: v.wholesale.breaks.map((b) => ({ min_quantity: b.minQuantity, unit_price_ngn: b.unitPrice / 100 })) } : {}) });
    },
  }),

  calculate_cart_total: tool({
    description: "Recalculate the customer's cart on the server. Optionally include delivery for a state and shipping method. Always use this (never your own arithmetic) for totals.",
    schema: z.object({ state: z.string().trim().max(40).optional(), shipping_method_id: uuid.optional() }),
    async run(a, ctx) {
      const cartId = await ctx.getCartId(false);
      const pctx = pricingContextFor(ctx.user);
      const state = a.state ? resolveState(a.state) : null;
      if (a.state && !state) return fail("Unknown Nigerian state.");
      let shippingName: string | null = null;
      const cart = await getCartView(cartId, pctx, { userId: ctx.user?.id, email: ctx.user?.email }, state && a.shipping_method_id ? async (c) => {
        const q = await quoteShipping(a.shipping_method_id!, { state, ...c });
        shippingName = q.name;
        return q.fee;
      } : undefined);
      return ok({ ...cartForModel(cart), shipping_method: shippingName, shipping_ngn: cart.totals.shippingTotal / 100, tax_ngn: cart.totals.taxTotal / 100, total_ngn: cart.totals.total / 100 }, [cartAttachment(cart)]);
    },
  }),

  add_item_to_cart: tool({
    description: "Add a product variant to the customer's cart. Only call after the customer has chosen the product and quantity.",
    ordering: true,
    schema: z.object({ variant_id: uuid, quantity: qty }),
    async run(a, ctx) {
      const cartId = (await ctx.getCartId(true))!;
      const res = await addCartItem(cartId, a.variant_id, a.quantity);
      invalidateQuote(ctx);
      const cart = await viewCart(ctx);
      return ok({ added: res.productName, quantity_in_cart: res.quantity, cart: cartForModel(cart) }, [cartAttachment(cart)]);
    },
  }),

  update_cart_quantity: tool({
    description: "Set the quantity of an item already in the cart (0 removes it).",
    ordering: true,
    schema: z.object({ variant_id: uuid, quantity: z.number().int().min(0).max(10_000) }),
    async run(a, ctx) {
      const cartId = await ctx.getCartId(false);
      if (!cartId) return fail("The cart is empty.");
      await setCartItemQuantity(cartId, a.variant_id, a.quantity);
      invalidateQuote(ctx);
      const cart = await viewCart(ctx);
      return ok({ cart: cartForModel(cart) }, [cartAttachment(cart)]);
    },
  }),

  remove_cart_item: tool({
    description: "Remove an item from the cart.",
    ordering: true,
    schema: z.object({ variant_id: uuid }),
    async run(a, ctx) {
      const cartId = await ctx.getCartId(false);
      if (!cartId) return fail("The cart is empty.");
      await removeCartItem(cartId, a.variant_id);
      invalidateQuote(ctx);
      const cart = await viewCart(ctx);
      return ok({ cart: cartForModel(cart) }, [cartAttachment(cart)]);
    },
  }),

  retrieve_shipping_options: tool({
    description: "List the delivery methods, live fees and estimated delivery windows available for a Nigerian state, based on the current cart.",
    schema: z.object({ state: z.string().trim().min(2).max(40) }),
    async run(a, ctx) {
      const state = resolveState(a.state);
      if (!state) return fail(`"${a.state}" is not a recognised Nigerian state. Valid states: ${NIGERIAN_STATES.join(", ")}.`);
      const cart = await viewCart(ctx);
      const options = await getShippingOptions({ state, itemCount: Math.max(cart.itemCount, 1), subtotal: cart.totals.subtotal, freeShipping: cart.coupon?.freeShipping });
      if (!options.length) return ok({ state, options: [], message: "No delivery method is configured for this state. Offer human support." });
      return ok({ state, based_on_cart: cart.itemCount > 0, options: options.map((o) => ({ shipping_method_id: o.id, name: o.name, fee_ngn: o.fee / 100, estimated_delivery: o.etaText })) }, [{ type: "options", options: options.map((o) => ({ label: `${o.name} — ${o.fee === 0 ? "Free" : `₦${(o.fee / 100).toLocaleString("en-NG")}`} · ${o.etaText}`, value: o.name })) }]);
    },
  }),

  calculate_shipping: tool({
    description: "Get the live delivery fee and estimate for one shipping method and state, based on the current cart.",
    schema: z.object({ state: z.string().trim().min(2).max(40), shipping_method_id: uuid }),
    async run(a, ctx) {
      const state = resolveState(a.state);
      if (!state) return fail("Unknown Nigerian state.");
      const cart = await viewCart(ctx);
      const q = await quoteShipping(a.shipping_method_id, { state, itemCount: Math.max(cart.itemCount, 1), subtotal: cart.totals.subtotal, freeShipping: cart.coupon?.freeShipping });
      return ok({ name: q.name, fee_ngn: q.fee / 100, estimated_delivery: q.etaText });
    },
  }),

  get_customer_addresses: tool({
    description: "List the signed-in customer's saved delivery addresses.",
    schema: z.object({}),
    async run(_a, ctx) {
      if (!ctx.user) return denied("The customer is not signed in. Ask for their delivery details instead, or invite them to sign in.");
      const rows = await db.select().from(addresses).where(and(eq(addresses.userId, ctx.user.id), isNull(addresses.deletedAt)));
      return ok({ addresses: rows.map((r) => ({ address_id: r.id, label: r.label, full_name: r.fullName, phone: r.phone, line1: r.line1, city: r.city, state: r.state, is_default: r.isDefault })) });
    },
  }),

  create_order: tool({
    description:
      "Create the order from the customer's cart. The first call returns CONFIRMATION_REQUIRED with a server-calculated summary that is shown to the customer; the order is only created after the customer explicitly confirms it. You cannot confirm on the customer's behalf. Payment happens afterwards on the secure payment page.",
    ordering: true,
    schema: orderArgs,
    async run(a, ctx) {
      const cartId = await ctx.getCartId(false);
      const pctx = pricingContextFor(ctx.user);
      if (!cartId) return fail("The cart is empty.");

      let name = a.contact_name ?? ctx.user?.name;
      const email = ctx.user?.email ?? a.contact_email; // signed-in customers always order under their own email
      let phone = a.contact_phone ?? ctx.user?.phone ?? undefined;
      let line1 = a.address_line1;
      let city = a.city;
      let stateRaw = a.state;
      if (a.address_id) {
        if (!ctx.user) return denied("Saved addresses require the customer to be signed in.");
        const [addr] = await db.select().from(addresses).where(and(eq(addresses.id, a.address_id), eq(addresses.userId, ctx.user.id), isNull(addresses.deletedAt)));
        if (!addr) return denied("That address does not belong to this customer.");
        name = addr.fullName;
        phone = addr.phone;
        line1 = addr.line1;
        city = addr.city;
        stateRaw = addr.state;
      }
      const missing = [!name && "full name", !email && "email address", !phone && "phone number", !line1 && "street address", !city && "city", !stateRaw && "state"].filter(Boolean);
      if (missing.length) return { ok: false, status: "INVALID", data: { error: `Missing delivery details: ${missing.join(", ")}. Ask the customer for them.` } };
      const state = resolveState(stateRaw!);
      const normPhone = normalizeNigerianPhone(phone!);
      if (!state) return { ok: false, status: "INVALID", data: { error: "The state is not a recognised Nigerian state." } };
      if (!normPhone) return { ok: false, status: "INVALID", data: { error: "The phone number is not a valid Nigerian mobile number." } };

      let shippingName = "";
      let eta = "";
      const cart = await getCartView(cartId, pctx, { userId: ctx.user?.id, email }, async (c) => {
        const q = await quoteShipping(a.shipping_method_id, { state, ...c });
        shippingName = q.name;
        eta = q.etaText;
        return q.fee;
      });
      if (!cart.lines.length) return fail("The cart is empty.");
      if (cart.hasIssues) return fail(`Some items cannot be ordered: ${cart.lines.filter((l) => l.issue).map((l) => `${l.name} — ${l.issue}`).join("; ")}`);

      const args = { contact_name: name!, contact_email: email!, contact_phone: normPhone, address_line1: line1!, city: city!, state, shipping_method_id: a.shipping_method_id };
      const hash = sha256(JSON.stringify({ args, lines: cart.lines.map((l) => [l.variantId, l.quantity, l.unitPrice]), total: cart.totals.total }));

      if (ctx.state.confirmedHash !== hash) {
        ctx.state.quote = { hash, args, createdAt: Date.now() };
        delete ctx.state.confirmedHash;
        const summary: ChatAttachment = { type: "order_summary", lines: cartLines(cart), subtotal: cart.totals.subtotal, discount: cart.totals.discountTotal, shipping: cart.totals.shippingTotal, tax: cart.totals.taxTotal, total: cart.totals.total, deliverTo: `${line1}, ${city}, ${state}`, shippingMethod: shippingName, eta, contact: `${name} · ${email} · ${normPhone}` };
        return { ok: true, status: "OK", data: { status: "CONFIRMATION_REQUIRED", message: "The order summary has been shown to the customer. Ask them to confirm it. Do not say the order has been placed.", total_ngn: cart.totals.total / 100, shipping_ngn: cart.totals.shippingTotal / 100, shipping_method: shippingName, estimated_delivery: eta }, attachments: [summary] };
      }

      // Explicitly confirmed by the customer for exactly this cart, address and total.
      delete ctx.state.confirmedHash;
      delete ctx.state.quote;
      const created = await placeOrder({ cartId, user: ctx.user, contact: { name: name!, email: email!, phone: normPhone }, address: { fullName: name!, phone: normPhone, line1: line1!, city: city!, state }, shippingMethodId: a.shipping_method_id, source: "AI", conversationId: ctx.conversationId });
      ctx.state.lastOrderNumber = created.order.number;
      delete ctx.state.checkout;
      delete ctx.state.focus;
      const url = orderUrl(created.order);
      return ok(
        { status: "ORDER_CREATED_AWAITING_PAYMENT", order_number: created.order.number, total_ngn: created.order.total / 100, payment_status: "NOT PAID — the customer must complete payment on the secure payment page. Never say payment succeeded; use get_order_status to check.", payment_link_shown_to_customer: !!created.authorizationUrl, payment_error: created.paymentError },
        [{ type: "payment", orderNumber: created.order.number, total: created.order.total, paymentUrl: created.authorizationUrl, orderUrl: url }],
      );
    },
  }),

  get_order_status: tool({
    description: "Look up the live status of an order. Signed-in customers can only see their own orders; guests must supply the order number and the email used at checkout.",
    schema: z.object({ order_number: z.string().trim().min(6).max(30), email: z.string().trim().email().optional() }),
    async run(a, ctx) {
      const order = await getOrderFull({ number: a.order_number });
      // Orders created in this very conversation belong to this browser session.
      const owns = !!order && (order.conversationId === ctx.conversationId || (ctx.user && order.userId === ctx.user.id) || (!!a.email && order.email.toLowerCase() === a.email.toLowerCase()) || (!!ctx.user && order.email.toLowerCase() === ctx.user.email.toLowerCase()));
      // Same answer for "does not exist" and "not yours" so order numbers cannot be probed.
      if (!order || !owns) return denied(ctx.user || a.email ? "No order matching those details was found for this customer." : "To look up an order, the customer must sign in or provide the order number together with the email address used at checkout.");
      const paid = order.payments.some((p) => p.status === "SUCCESS");
      const shipment = order.shipments[0];
      return ok(
        { order_number: order.number, status: ORDER_STATUS_LABELS[order.status], payment_verified: paid, total_ngn: order.total / 100, placed_at: order.createdAt.toISOString(), delivery_method: order.shippingMethod.name, items: order.items.map((i) => `${i.quantity} × ${i.productName}`), tracking: shipment ? { carrier: shipment.carrier, tracking_number: shipment.trackingNumber } : null },
        [{ type: "order_status", orderNumber: order.number, status: order.status, statusLabel: ORDER_STATUS_LABELS[order.status], total: order.total, orderUrl: orderUrl(order) }],
      );
    },
  }),

  request_human_support: tool({
    description: "Escalate the conversation to a human AUREX support agent. Use when the customer asks for a person, is unhappy, or you cannot answer from live data.",
    schema: z.object({ reason: z.string().trim().min(3).max(500), contact_email: z.string().trim().email().optional(), contact_phone: z.string().trim().max(30).optional() }),
    async run(a, ctx) {
      const [existing] = await db.select().from(supportTickets).where(and(eq(supportTickets.conversationId, ctx.conversationId), eq(supportTickets.status, "OPEN"))).limit(1);
      if (existing) return ok({ ticket_number: existing.number, message: "A support request is already open for this conversation." }, [{ type: "handoff", ticketNumber: existing.number }]);
      const number = `SUP-${randomToken(5).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase()}`;
      const email = ctx.user?.email ?? a.contact_email ?? null;
      await db.transaction(async (tx) => {
        await tx.insert(supportTickets).values({ number, userId: ctx.user?.id ?? null, conversationId: ctx.conversationId, name: ctx.user?.name ?? null, email, phone: a.contact_phone ?? ctx.user?.phone ?? null, subject: "Assistant escalation", message: a.reason, source: "AI_ESCALATION" });
        await tx.update(aiConversations).set({ status: "ESCALATED" }).where(eq(aiConversations.id, ctx.conversationId));
        if (email) await queueNotification({ template: "support_ticket", recipient: email, userId: ctx.user?.id, payload: { name: ctx.user?.name ?? "", ticketNumber: number } }, tx);
      });
      return ok({ ticket_number: number, has_contact: !!email, message: email ? "A human agent will follow up by email." : "Ticket created. Ask the customer for an email address or phone number so an agent can reach them." }, [{ type: "handoff", ticketNumber: number }]);
    },
  }),
};

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

/** JSON-schema tool specs for OpenAI-compatible providers. */
export function toolSpecs(orderingEnabled: boolean) {
  return TOOL_NAMES.filter((n) => orderingEnabled || !(TOOLS[n] as ToolDef<z.ZodType>).ordering).map((name) => {
    const { $schema: _s, ...parameters } = z.toJSONSchema(TOOLS[name].schema) as Record<string, unknown>;
    return { type: "function" as const, function: { name, description: TOOLS[name].description, parameters } };
  });
}

/**
 * Executes a tool call coming from the model (or the built-in engine) with full validation,
 * authorisation and an audit trail in ai_tool_executions.
 */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now();
  let result: ToolResult;
  const def = (TOOLS as Record<string, ToolDef<z.ZodType> | undefined>)[name];
  if (!def || !Object.hasOwn(TOOLS, name)) result = { ok: false, status: "INVALID", data: { error: `Unknown tool "${name}".` } };
  else if (def.ordering && !ctx.orderingEnabled) result = denied("Ordering through the assistant is currently disabled. Direct the customer to the website cart and checkout.");
  else {
    const parsed = def.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) result = { ok: false, status: "INVALID", data: { error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` } };
    else {
      try {
        result = await def.run(parsed.data, ctx);
      } catch (e) {
        if (e instanceof AppError) result = { ok: false, status: e.status === 403 || e.status === 401 ? "DENIED" : "ERROR", data: { error: e.message } };
        else {
          reportError(e, { scope: "ai.tool", tool: name });
          result = fail("The tool failed unexpectedly. Apologise and offer human support.");
        }
      }
    }
  }
  try {
    await db.insert(aiToolExecutions).values({ conversationId: ctx.conversationId, toolName: name.slice(0, 80), input: (rawArgs ?? {}) as object, output: result.data as object, status: result.status ?? (result.ok ? "OK" : "ERROR"), durationMs: Date.now() - started });
  } catch (e) {
    reportError(e, { scope: "ai.tool.log" });
  }
  return result;
}
