import { findStateInText, normalizeNigerianPhone, resolveState } from "@/lib/nigeria";
import { listCategoryRecords, listDeviceRecords } from "../catalog";
import { deviceLabel, normalizeText, resolveDevice } from "../compatibility";
import { parseQuery } from "../query-parser";
import { searchKnowledge } from "./knowledge";
import type { ConversationState, ToolContext, ToolResult } from "./types";

/**
 * Built-in assistant engine.
 *
 * A deterministic dialogue manager used when no LLM provider is configured (and as the fallback
 * when a provider call fails). It drives exactly the same server-side tools as the LLM, so every
 * price, stock figure, delivery fee and order status in its replies comes from live data.
 */
export type Exec = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
export type EngineReply = { text: string; unresolved?: boolean };

const naira = (n: number) => `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const NUMBER_WORDS: Record<string, number> = { one: 1, a: 1, an: 1, single: 1, two: 2, couple: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
const ORDINALS: Record<string, number> = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3, fifth: 4, "5th": 4, sixth: 5, "6th": 5 };
const AFFIRM = /^(yes|yeah|yep|yup|ok|okay|sure|please do|go ahead|alright|correct|that'?s right|confirm|i confirm|proceed)\b/i;
const NEGATE = /^(no|nope|nah|not now|don'?t)\b/i;
const ORDER_NO = /\bAUR-\d{6}-[A-Z0-9]{6}\b/i;
const EMAIL = /[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i;

export function isAffirmative(text: string): boolean {
  const t = text.trim();
  return AFFIRM.test(t) && !/\b(but|change|instead|wait|not)\b/i.test(t);
}

/** Extracts a purchase quantity, ignoring numbers that belong to model names (A15, 4G, 25W…). */
export function parseQuantity(text: string, opts: { allowArticle?: boolean } = {}): number | null {
  const t = normalizeText(text).replace(/\b(first|second|third|fourth|fifth|last|this|that|the|which|other|cheaper|cheapest) one\b/g, " ");
  const m = t.match(/(?:^|\s)(\d{1,4})(?=\s|$)(?!\s*(?:g|w|mah|mp|inch|pin|in)\b)/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 10_000) return n;
  }
  for (const w of t.split(" ")) {
    if (w in NUMBER_WORDS && (opts.allowArticle || (w !== "a" && w !== "an"))) return NUMBER_WORDS[w]!;
  }
  return null;
}

const d = (r: ToolResult) => r.data as Record<string, unknown>;
const err = (r: ToolResult) => String(d(r).error ?? "Something went wrong.");

type ModelProduct = { product_id: string; name: string; quality_grade: string | null; warranty_months: number; variants: { variant_id: string; name: string; unit_price_ngn: number; in_stock: boolean; available_quantity: number }[] };
type ModelCart = { items: { variant_id: string; name: string; variant: string; quantity: number; line_total_ngn: number }[]; item_count: number; subtotal_ngn: number };

function describeProducts(products: ModelProduct[]): string {
  const lines: string[] = [];
  let i = 1;
  for (const p of products) {
    for (const v of p.variants) {
      const label = p.variants.length > 1 ? `${p.name} (${v.name})` : p.name;
      const grade = p.variants.length > 1 ? null : p.quality_grade;
      lines.push(`${i++}. ${label}${grade ? ` — ${grade}` : ""} — ${naira(v.unit_price_ngn)} — ${v.in_stock ? `in stock (${v.available_quantity})` : "out of stock"}${p.warranty_months ? ` — ${p.warranty_months}-month warranty` : ""}`);
    }
  }
  return lines.join("\n");
}

function matchOption(text: string, options: NonNullable<ConversationState["focus"]>["options"], allowIndex: boolean): number | null {
  const t = normalizeText(text);
  const words = t.split(" ");
  for (const w of words) if (w in ORDINALS && ORDINALS[w]! < options.length) return ORDINALS[w]!;
  if (/\blast\b/.test(t)) return options.length - 1;
  if (allowIndex) {
    const m = t.match(/^(?:option |number |no )?(\d{1,2})$/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= options.length) return Number(m[1]) - 1;
  }
  const generic = new Set(["the", "one", "option", "samsung", "galaxy", "iphone", "display", "screen", "battery", "for", "of", "i", "need", "want", "add", "take", "ll", "please", "two", "three"]);
  const tokens = words.filter((w) => w.length > 2 && !generic.has(w));
  if (!tokens.length) return null;
  const scores = options.map((o) => {
    const hay = ` ${normalizeText(`${o.label} ${o.grade ?? ""}`)} `;
    return tokens.filter((tk) => hay.includes(` ${tk} `) || hay.includes(` ${tk}`)).length;
  });
  const best = Math.max(...scores);
  if (best === 0 || scores.filter((s) => s === best).length > 1) return null;
  return scores.indexOf(best);
}

/* ───────────────────────── Checkout dialogue ───────────────────────── */

const FIELD_PROMPTS = {
  name: "Great — let's get your delivery details. What is the full name of the person receiving the order?",
  email: "What email address should we send your order confirmation to?",
  phone: "What phone number should the rider call? (Nigerian mobile, e.g. 0803 123 4567)",
  line1: "What is the delivery street address? (house number and street)",
  city: "Which city or town is that in?",
  state: "And which state?",
} as const;

async function advanceCheckout(ctx: ToolContext, exec: Exec, prefix = ""): Promise<EngineReply> {
  const st = ctx.state;
  const c = (st.checkout ??= {});
  const say = (text: string): EngineReply => ({ text: `${prefix}${text}`.trim() });
  if (!ctx.orderingEnabled) {
    delete st.checkout;
    return say("Ordering through the assistant is switched off at the moment, but your cart is saved — you can complete your order on the [checkout page](/checkout).");
  }
  if (ctx.user) {
    c.name ??= ctx.user.name;
    c.email = ctx.user.email;
    if (!c.line1 && !c.usedSavedAddress) {
      c.usedSavedAddress = true;
      const res = await exec("get_customer_addresses", {});
      const list = (d(res).addresses as { full_name: string; phone: string; line1: string; city: string; state: string; is_default: boolean }[] | undefined) ?? [];
      const a = list.find((x) => x.is_default) ?? list[0];
      if (a) {
        Object.assign(c, { name: a.full_name, phone: a.phone, line1: a.line1, city: a.city, state: a.state });
        prefix += `I'll use your saved address: ${a.line1}, ${a.city}, ${a.state}. (Say "change address" to use a different one.)\n\n`;
      }
    }
  }
  for (const field of ["name", "email", "phone", "line1", "city", "state"] as const) {
    if (!c[field]) {
      c.awaiting = field;
      return { text: `${prefix}${FIELD_PROMPTS[field]}`.trim() };
    }
  }
  if (!c.shippingMethodId) {
    const res = await exec("retrieve_shipping_options", { state: c.state });
    const options = (d(res).options as { shipping_method_id: string; name: string; fee_ngn: number; estimated_delivery: string }[] | undefined) ?? [];
    if (!res.ok || !options.length) {
      delete st.checkout;
      return { text: `${prefix}I'm sorry — I couldn't find a delivery option for ${c.state}. I can connect you with our support team to arrange delivery; just say "talk to an agent".`, unresolved: true };
    }
    if (options.length === 1) {
      c.shippingMethodId = options[0]!.shipping_method_id;
      prefix += `Delivery to ${c.state}: ${options[0]!.name} — ${options[0]!.fee_ngn === 0 ? "free" : naira(options[0]!.fee_ngn)}, ${options[0]!.estimated_delivery}.\n\n`;
    } else {
      c.shippingOptions = options.map((o) => ({ id: o.shipping_method_id, name: o.name }));
      c.awaiting = "shipping";
      return { text: `${prefix}Here are the delivery options for ${c.state}:\n${options.map((o, i) => `${i + 1}. ${o.name} — ${o.fee_ngn === 0 ? "free" : naira(o.fee_ngn)} — ${o.estimated_delivery}`).join("\n")}\n\nWhich would you like?` };
    }
  }
  const res = await exec("create_order", { contact_name: c.name, contact_email: c.email, contact_phone: c.phone, address_line1: c.line1, city: c.city, state: c.state, shipping_method_id: c.shippingMethodId });
  if (!res.ok) {
    delete c.awaiting;
    return { text: `${prefix}I couldn't prepare the order: ${err(res)}` };
  }
  c.awaiting = "confirm";
  return { text: `${prefix}Your order summary is ready. The total is ${naira(Number(d(res).total_ngn))} including delivery. Please check the details below and reply "confirm" (or tap Confirm order) to place the order — or tell me what to change.` };
}

async function handleCheckoutInput(text: string, ctx: ToolContext, exec: Exec): Promise<EngineReply | null> {
  const c = ctx.state.checkout!;
  const t = text.trim();
  switch (c.awaiting) {
    case "name":
      if (t.length < 2 || t.length > 100 || /\d/.test(t)) return { text: "Please enter the receiver's full name." };
      c.name = t;
      break;
    case "email": {
      const m = t.match(EMAIL);
      if (!m) return { text: "That doesn't look like a valid email address. Please type it again (for example name@example.com)." };
      c.email = m[0].toLowerCase();
      break;
    }
    case "phone": {
      const p = normalizeNigerianPhone(t.replace(/[^\d+]/g, ""));
      if (!p) return { text: "That doesn't look like a valid Nigerian mobile number. Please enter it like 0803 123 4567." };
      c.phone = p;
      break;
    }
    case "line1": {
      if (t.length < 5) return { text: "Please enter the street address, including the house number." };
      c.line1 = t.slice(0, 200);
      const s = findStateInText(t);
      if (s && !c.state && /,/.test(t)) c.state = s; // "12 Allen Avenue, Ikeja, Lagos"
      break;
    }
    case "city":
      if (t.length < 2) return { text: "Please enter the city or town." };
      c.city = t.slice(0, 80);
      break;
    case "state": {
      const s = resolveState(t) ?? findStateInText(t);
      if (!s) return { text: "I didn't recognise that state. Please enter a Nigerian state, e.g. Lagos, Oyo, Rivers or FCT." };
      c.state = s;
      break;
    }
    case "shipping": {
      const opts = c.shippingOptions ?? [];
      const idx = matchOption(t, opts.map((o) => ({ productId: "", variantId: o.id, label: o.name, grade: null })), true);
      if (idx === null) return { text: `Please choose a delivery option by number (1–${opts.length}).` };
      c.shippingMethodId = opts[idx]!.id;
      break;
    }
    default:
      return null;
  }
  delete c.awaiting;
  return advanceCheckout(ctx, exec);
}

/* ───────────────────────────── Main turn ───────────────────────────── */

export async function builtinTurn(text: string, ctx: ToolContext, exec: Exec): Promise<EngineReply> {
  const st = ctx.state;
  const lower = text.toLowerCase().trim();
  const norm = normalizeText(text);

  // Human hand-off always wins.
  if (/\b(human|agent|real person|representative|customer (care|service)|speak to (someone|a person)|talk to (someone|a person|support)|complain|complaint)\b/.test(lower)) {
    const res = await exec("request_human_support", { reason: text.slice(0, 500), ...(text.match(EMAIL) ? { contact_email: text.match(EMAIL)![0] } : {}) });
    if (!res.ok) return { text: `I couldn't open a support request: ${err(res)}`, unresolved: true };
    return { text: d(res).has_contact === false ? `I've opened support request ${d(res).ticket_number}. What email address or phone number should our agent use to reach you?` : `I've passed this conversation to our support team (reference ${d(res).ticket_number}). A human agent will follow up with you shortly. Is there anything else I can help with meanwhile?` };
  }

  if (st.checkout?.awaiting) {
    if (/^(cancel|stop|never ?mind|exit|quit|forget it)\b/.test(lower)) {
      delete st.checkout;
      delete st.quote;
      return { text: "No problem — I've stopped the checkout and nothing has been ordered. Your cart is still saved. What would you like to do next?" };
    }
    if (st.checkout.awaiting === "confirm") {
      if (/\b(change|edit|wrong|different|update)\b/.test(lower) || NEGATE.test(lower)) {
        const keep = { name: st.checkout.name, email: st.checkout.email, phone: st.checkout.phone };
        st.checkout = /address|deliver|state|city/.test(lower) || NEGATE.test(lower) ? { ...keep, usedSavedAddress: true } : {};
        delete st.quote;
        return advanceCheckout(ctx, exec, "No problem — nothing has been placed yet. Let's update the delivery details.\n\n");
      }
      delete st.checkout.awaiting; // fall through to normal handling (e.g. adding another item)
    } else {
      const handled = await handleCheckoutInput(text, ctx, exec);
      if (handled) return handled;
    }
  }
  if (st.checkout && /\bchange (the |my )?address\b/.test(lower)) {
    st.checkout = { name: st.checkout.name, email: st.checkout.email, usedSavedAddress: true };
    delete st.quote;
    return advanceCheckout(ctx, exec);
  }

  // Order status
  const orderNo = text.match(ORDER_NO)?.[0]?.toUpperCase() ?? (st.pendingOrderLookup && text.match(EMAIL) ? st.pendingOrderLookup : null);
  const asksOrder = /\b(track|tracking|where('?s| is) my (order|package|parcel)|order status|status of my order|my order|has my payment|did you (get|receive) my payment|payment (go|went) through|have i paid)\b/.test(lower);
  if (orderNo || asksOrder) {
    const number = orderNo ?? st.lastOrderNumber;
    const email = text.match(EMAIL)?.[0];
    if (!number) return { text: `I can check that for you. What is your order number? It starts with "AUR-".${ctx.user ? "" : " Please also include the email address used at checkout."}` };
    if (!ctx.user && !email && number !== st.lastOrderNumber) {
      st.pendingOrderLookup = number;
      return { text: "To protect your privacy, please confirm the email address used when placing that order." };
    }
    delete st.pendingOrderLookup;
    const res = await exec("get_order_status", { order_number: number, ...(email ? { email } : {}) });
    if (!res.ok) {
      if (number === st.lastOrderNumber && !ctx.user && !email) {
        st.pendingOrderLookup = number;
        return { text: "To protect your privacy, please confirm the email address used when placing that order." };
      }
      return { text: "I couldn't find an order matching those details. Please check the order number and email address, or I can connect you to a human agent." };
    }
    const o = d(res);
    const tracking = o.tracking as { carrier?: string; tracking_number?: string } | null;
    return { text: `Order ${o.order_number} is currently: ${o.status}. ${o.payment_verified ? "Payment has been verified." : "Payment has not been verified yet."} Total: ${naira(Number(o.total_ngn))}. Delivery: ${o.delivery_method}.${tracking?.tracking_number ? ` Tracking: ${tracking.carrier ?? ""} ${tracking.tracking_number}.` : ""}` };
  }

  const [devices, cats] = await Promise.all([listDeviceRecords(), listCategoryRecords()]);
  const parsed = parseQuery(text, devices, cats);
  const quantityText = parsed.device.status === "none" ? text : ` ${norm} `.replace(` ${parsed.device.matchedText} `, " ");
  const wantsAdd = /\b(add|need|want|take|give me|buy|get me|i'?ll have|order)\b/.test(lower);

  // Reply to "which model do you have?"
  if (st.pending?.kind === "device") {
    const pending = st.pending;
    const candidates = devices.filter((x) => pending.candidateIds.includes(x.id));
    let chosen = resolveDevice(text, candidates);
    if (chosen.status !== "exact") {
      const idx = matchOption(text, candidates.map((c) => ({ productId: "", variantId: c.id, label: deviceLabel(c), grade: null })), true);
      if (idx !== null) chosen = { status: "exact", device: candidates[idx]!, matchedText: "" };
    }
    if (chosen.status !== "exact") {
      // Short replies such as "the 4G one" or "5g": pick the candidate whose name alone contains one of the words used.
      const words = new Set(lower.split(/[^a-z0-9+]+/).filter(Boolean));
      const hits = candidates.filter((c) => {
        const own = deviceLabel(c).toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);
        return own.some((w) => words.has(w) && !candidates.some((o) => o.id !== c.id && deviceLabel(o).toLowerCase().split(/[^a-z0-9+]+/).includes(w)));
      });
      if (hits.length === 1) chosen = { status: "exact", device: hits[0]!, matchedText: "" };
    }
    if (chosen.status === "exact") {
      delete st.pending;
      const cat = cats.find((c) => c.id === pending.categoryId) ?? null;
      return showProducts(ctx, exec, { deviceId: chosen.device.id, deviceName: deviceLabel(chosen.device), categorySlug: cat?.slug, categoryName: cat?.name, quantity: parseQuantity(pending.text) });
    }
    if (parsed.device.status === "none" && !parsed.category) return { text: `Sorry, I didn't catch which model. Is it the ${candidates.map(deviceLabel).join(" or the ")}? You can check under Settings › About phone.` };
    delete st.pending;
  }

  // Choosing among shown products / quantities
  const options = st.focus?.options ?? [];
  const pendingQty = st.pending?.kind === "choose_product" ? st.pending.quantity : null;
  const selecting = options.length > 0 && parsed.device.status === "none" && (st.pending?.kind === "choose_product" || wantsAdd || parseQuantity(quantityText) !== null || matchOption(text, options, false) !== null || (isAffirmative(text) && options.length === 1));
  const asksInfo = /\b(price|cost|how much|available|availability|in stock|warranty|spec|specs|details)\b/.test(lower) && !wantsAdd;
  if (selecting && !asksInfo && !/\b(checkout|check out|remove|delete|cart)\b/.test(lower)) {
    const bareNumber = /^\s*\d{1,2}\s*$/.test(text);
    const chooseMode = st.pending?.kind === "choose_product" && options.length > 1;
    const idx = options.length === 1 ? 0 : matchOption(text, options, chooseMode && pendingQty !== null ? true : chooseMode && bareNumber);
    const quantity = chooseMode && bareNumber && idx !== null && pendingQty !== null ? pendingQty : (parseQuantity(quantityText) ?? pendingQty ?? (isAffirmative(text) && pendingQty === null && options.length === 1 ? null : null));
    if (idx !== null && quantity) {
      delete st.pending;
      const res = await exec("add_item_to_cart", { variant_id: options[idx]!.variantId, quantity });
      if (!res.ok) return { text: `I couldn't add that: ${err(res)}` };
      const cart = d(res).cart as ModelCart;
      return { text: `Great. I've put ${quantity} × ${options[idx]!.label} in your cart (cart subtotal ${naira(cart.subtotal_ngn)}). Would you like to add anything else, or shall we continue to checkout?` };
    }
    if (idx !== null) {
      st.focus = { ...st.focus!, options: [options[idx]!] };
      st.pending = { kind: "choose_product", quantity: null };
      return { text: `${options[idx]!.label} — how many would you like?` };
    }
    if (quantity && !isAffirmative(text)) {
      st.pending = { kind: "choose_product", quantity };
      return { text: `Which option would you like ${quantity} of?\n${options.map((o, i) => `${i + 1}. ${o.label}${o.grade ? ` — ${o.grade}` : ""}`).join("\n")}` };
    }
    if (!parsed.category && parsed.terms.length === 0 && options.length > 1) return { text: `Which one would you like? Reply with the number:\n${options.map((o, i) => `${i + 1}. ${o.label}${o.grade ? ` — ${o.grade}` : ""}`).join("\n")}` };
  }

  // Cart commands
  if (/\b(remove|delete|take out)\b/.test(lower) || /\b(clear|empty)\b.*\bcart\b/.test(lower)) {
    const view = await exec("calculate_cart_total", {});
    const items = (d(view).items as ModelCart["items"]) ?? [];
    if (!items.length) return { text: "Your cart is already empty." };
    const all = /\b(clear|empty|everything|all)\b/.test(lower);
    const idx = all ? null : items.length === 1 ? 0 : matchOption(text, items.map((i) => ({ productId: "", variantId: i.variant_id, label: `${i.name} ${i.variant}`, grade: null })), false);
    if (!all && idx === null) return { text: `Which item should I remove?\n${items.map((i, n) => `${n + 1}. ${i.quantity} × ${i.name}`).join("\n")}` };
    for (const it of all ? items : [items[idx!]!]) await exec("remove_cart_item", { variant_id: it.variant_id });
    return { text: all ? "I've emptied your cart." : `I've removed ${items[idx!]!.name} from your cart. Anything else?` };
  }
  if (/\b(my cart|view cart|show (me )?(the |my )?cart|what('?s| is) in (my|the) cart|cart total)\b/.test(lower)) {
    const view = await exec("calculate_cart_total", {});
    const cart = d(view) as unknown as ModelCart;
    if (!cart.items?.length) return { text: "Your cart is empty. Tell me your phone model and the part you need, and I'll find what fits." };
    return { text: `You have ${cart.item_count} item(s) in your cart, subtotal ${naira(cart.subtotal_ngn)}. Say "checkout" when you're ready, or tell me what else you need.` };
  }

  // Checkout intent
  const checkoutIntent = /\b(checkout|check out|continue|proceed|pay now|place (the |my )?order|that'?s all|that is all|nothing else|i'?m done)\b/.test(lower) || (/^(no|nope|nah)\b/.test(lower) && lower.length < 30 && !st.pending);
  if (checkoutIntent && parsed.device.status === "none" && !parsed.category) {
    const view = await exec("calculate_cart_total", {});
    const cart = d(view) as unknown as ModelCart;
    if (!cart.items?.length) return /^(no|nope|nah)\b/.test(lower) ? { text: "Alright! If you need anything later, just ask." } : { text: "Your cart is empty at the moment. Tell me which part you need and for which phone, and I'll get it ready." };
    delete st.pending;
    st.checkout = st.checkout && st.checkout.line1 ? { ...st.checkout, shippingMethodId: undefined, awaiting: undefined } : (st.checkout ?? {});
    return advanceCheckout(ctx, exec);
  }

  // Delivery fee / time for a state
  const state = findStateInText(text);
  if (/\b(deliver|delivery|shipping|ship|send|waybill|dispatch)\b/.test(lower) && parsed.device.status === "none" && !parsed.category) {
    if (state) {
      const res = await exec("retrieve_shipping_options", { state });
      const opts = (d(res).options as { name: string; fee_ngn: number; estimated_delivery: string }[] | undefined) ?? [];
      if (res.ok && opts.length) return { text: `Delivery to ${state}${d(res).based_on_cart ? " for your current cart" : ""}:\n${opts.map((o) => `• ${o.name} — ${o.fee_ngn === 0 ? "free" : naira(o.fee_ngn)} — ${o.estimated_delivery}`).join("\n")}\n\nThe exact fee is confirmed at checkout.` };
      return { text: `I couldn't find a delivery option for ${state} right now. I can connect you with our support team if you'd like.`, unresolved: true };
    }
    const hits = await searchKnowledge("shipping delivery", 1);
    return { text: `${hits[0] ? `${excerpt(hits[0].content)}\n\n` : ""}Which state should I check delivery fees and times for?` };
  }

  // Product discovery
  if (parsed.device.status !== "none" || parsed.category) {
    if (parsed.device.status === "ambiguous") {
      await exec("check_product_compatibility", { device: parsed.device.matchedText });
      st.pending = { kind: "device", candidateIds: parsed.device.candidates.map((x) => x.id), categoryId: parsed.category?.id ?? null, text: quantityText };
      const names = parsed.device.candidates.map(deviceLabel);
      const what = parsed.category ? ` ${singular(parsed.category.name)}` : "";
      return { text: `Sure! Are you looking for the ${names.slice(0, -1).join(", ")} or the ${names[names.length - 1]}${what}? They use different parts, so I want to make sure it fits.` };
    }
    if (parsed.device.status === "exact") return showProducts(ctx, exec, { deviceId: parsed.device.device.id, deviceName: deviceLabel(parsed.device.device), categorySlug: parsed.category?.slug, categoryName: parsed.category?.name, query: parsed.terms.join(" ") || undefined, quantity: wantsAdd ? parseQuantity(quantityText) : null });
    const res = await exec("search_products", { category: parsed.category!.slug, ...(parsed.terms.length ? { query: parsed.terms.join(" ") } : {}) });
    const products = (d(res).products as ModelProduct[] | undefined) ?? [];
    if (!products.length) return { text: parsed.terms.length ? `I couldn't find ${parsed.category!.name.toLowerCase()} matching "${parsed.terms.join(" ")}" in our catalogue, so I can't recommend a part that is confirmed to fit. If you tell me the exact phone model I'll check again, or I can connect you to a human agent.` : `We don't have any ${parsed.category!.name.toLowerCase()} listed right now.`, unresolved: parsed.terms.length > 0 };
    return { text: `Here are some of our ${parsed.category!.name.toLowerCase()}:\n${describeProducts(products)}\n\nWhich phone model is it for? Tell me the model and I'll show only the parts confirmed to fit.` };
  }

  // Knowledge base (policies, FAQs, business information)
  const hits = await searchKnowledge(text, 2);
  if (hits.length && hits[0]!.coverage >= 0.5) return { text: `${excerpt(hits[0]!.content)}${/wholesale/.test(lower) && !ctx.user?.wholesaleApproved ? "\n\nYou can apply from the [wholesale page](/wholesale)." : ""}` };

  // Free-text product search (e.g. "fast charger", SKU)
  if (parsed.terms.length) {
    const res = await exec("search_products", { query: parsed.terms.join(" ") });
    const products = (d(res).products as ModelProduct[] | undefined) ?? [];
    if (products.length) return { text: `Here's what I found:\n${describeProducts(products)}\n\nWould you like to add any of these to your cart?` };
  }

  if (/^(hi|hello|hey|good (morning|afternoon|evening|day)|howdy)\b/.test(lower) || norm.length === 0) return { text: "Hello! I'm the AUREX shopping assistant. Tell me your phone model and the part you need — for example \"screen for Samsung A15\" — and I'll find what fits, check stock and help you order. I can also answer questions about delivery, warranty, returns and your orders." };
  if (/\b(thanks|thank you|thank u|cheers)\b/.test(lower)) return { text: "You're welcome! Is there anything else I can help you with?" };

  return { text: "I'm sorry, I don't have reliable information on that, and I don't want to guess. I can connect you with a human AUREX agent — just say \"talk to an agent\" — or you can tell me your phone model and the part you need.", unresolved: true };
}

function singular(categoryName: string): string {
  const first = categoryName.split(/[&,]/)[0]!.trim().toLowerCase();
  return first.endsWith("ies") ? `${first.slice(0, -3)}y` : first.endsWith("s") ? first.slice(0, -1) : first;
}

function excerpt(content: string, max = 750): string {
  if (content.length <= max) return content;
  const paras = content.split(/\n\n+/);
  let out = "";
  for (const p of paras) {
    if ((out + p).length > max) break;
    out += (out ? "\n\n" : "") + p;
  }
  return out || `${content.slice(0, max)}…`;
}

async function showProducts(ctx: ToolContext, exec: Exec, q: { deviceId: string; deviceName: string; categorySlug?: string; categoryName?: string; query?: string; quantity?: number | null }): Promise<EngineReply> {
  const res = await exec("search_products", { device_id: q.deviceId, ...(q.categorySlug ? { category: q.categorySlug } : {}), ...(q.query ? { query: q.query } : {}) });
  if (!res.ok) return { text: `I couldn't search the catalogue: ${err(res)}`, unresolved: true };
  const products = (d(res).products as ModelProduct[] | undefined) ?? [];
  const what = q.categoryName ? singular(q.categoryName) : "part";
  if (!products.length) {
    return { text: `I checked our compatibility records and we don't currently list a ${what} for the ${q.deviceName}. I won't suggest a part that isn't confirmed to fit — would you like me to connect you with a human agent who can source it?`, unresolved: true };
  }
  const options = ctx.state.focus?.options ?? [];
  const inStock = products.flatMap((p) => p.variants).filter((v) => v.in_stock).length;
  const list = describeProducts(products);
  if (options.length === 1) {
    const only = products[0]!.variants[0]!;
    if (!only.in_stock) return { text: `I found the compatible ${what} for the ${q.deviceName}, but it is out of stock right now:\n${list}\n\nWould you like me to connect you with our team to check when it will be back?` };
    if (q.quantity) {
      ctx.state.pending = { kind: "choose_product", quantity: q.quantity };
      return { text: `I found the compatible ${what} for the ${q.deviceName}:\n${list}\n\nShall I add ${q.quantity} to your cart?` };
    }
    ctx.state.pending = { kind: "choose_product", quantity: null };
    return { text: `I found the compatible ${what} for the ${q.deviceName}:\n${list}\n\nHow many would you like?` };
  }
  ctx.state.pending = { kind: "choose_product", quantity: q.quantity ?? null };
  return { text: `I found ${options.length} ${q.categoryName ? `${what} options` : "parts"} confirmed to fit the ${q.deviceName}${inStock < options.length ? ` (${inStock} in stock)` : ""}:\n${list}\n\nWhich one would you like${q.quantity ? ` ${q.quantity} of` : ""}? Reply with the number, or tap "Add to cart".` };
}
