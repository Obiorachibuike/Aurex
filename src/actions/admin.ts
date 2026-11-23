"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { bool, int, kobo, optDate, optInt, optStr, runAction, str, uuidOrNull, type ActionState } from "@/lib/action";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { moderateReview } from "@/services/account";
import { decideWholesale, resolveUnresolved, updateCustomer, updateTicket } from "@/services/admin";
import { deleteKnowledge, deleteProduct, deleteRule, saveBrand, saveCategory, saveCoupon, saveDevice, saveGroup, saveKnowledge, saveMethod, saveProduct, saveRule, saveZone, setProductStatus, type ProductInput } from "@/services/admin-catalog";
import { postAgentMessage } from "@/services/ai/agent";
import { audit } from "@/services/audit";
import { clearCatalogCache } from "@/services/catalog";
import { adjustStock } from "@/services/inventory";
import { createSupplier, createWarehouse } from "@/services/procurement";
import { dispatchQueuedNotifications } from "@/services/notifications";
import type { OrderStatus } from "@/services/order-shared";
import { cancelOrder, decideRefund, updateFulfilmentStatus } from "@/services/orders";
import { reconcilePayments, verifyPayment } from "@/services/payments";
import { updateSetting } from "@/services/settings";

const uuid = z.string().uuid();
type S = ActionState;

/* ───────────────────────────── Products ───────────────────────────── */

/** `payload` is the JSON-encoded product form. Prices arrive in naira and are converted to kobo here. */
export async function saveProductAction(_p: S, fd: FormData): Promise<S> {
  let createdId = "";
  const id = optStr(fd, "id");
  const res = await runAction(async () => {
    const actor = await requirePermission("products.manage");
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(str(fd, "payload")) as Record<string, unknown>;
    } catch {
      throw new AppError("The form could not be read. Please reload the page and try again.");
    }
    const toKobo = (v: unknown) => (v === "" || v === null || v === undefined ? null : Math.round(Number(String(v).replace(/[,₦\s]/g, "")) * 100));
    const variants = (Array.isArray(raw.variants) ? raw.variants : []).map((v: Record<string, unknown>) => ({
      id: typeof v.id === "string" && v.id ? v.id : undefined,
      sku: String(v.sku ?? ""),
      name: String(v.name ?? "") || "Standard",
      retailPrice: toKobo(v.retailPrice) ?? 0,
      compareAtPrice: toKobo(v.compareAtPrice),
      wholesalePrice: toKobo(v.wholesalePrice),
      minWholesaleQty: Number(v.minWholesaleQty) || 1,
      stock: v.stock === "" || v.stock === undefined ? 0 : Number(v.stock),
      lowStockThreshold: v.lowStockThreshold === "" || v.lowStockThreshold === undefined ? 5 : Number(v.lowStockThreshold),
    }));
    const saved = await saveProduct({ ...(raw as object), variants } as ProductInput, actor.id, id);
    if (!id) createdId = saved.id;
    revalidatePath("/", "layout");
    return { message: "Product saved" };
  });
  if (res.ok && createdId) redirect(`/admin/products/${createdId}?created=1`);
  return res;
}

export async function productStatusAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("products.manage");
    const status = z.enum(["DRAFT", "ACTIVE", "ARCHIVED", "DELETE"]).parse(str(fd, "status"));
    const id = uuid.parse(str(fd, "id"));
    if (status === "DELETE") await deleteProduct(id, actor.id);
    else await setProductStatus(id, status, actor.id);
    revalidatePath("/", "layout");
    return { message: status === "DELETE" ? "Product deleted" : status === "ARCHIVED" ? "Product archived" : status === "ACTIVE" ? "Product published" : "Product moved to drafts" };
  });
}

export async function adjustStockAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("inventory.manage");
    const mode = z.enum(["SET", "DELTA"]).parse(str(fd, "mode"));
    const value = int(fd, "value");
    if (!Number.isFinite(value)) throw new AppError("Enter a whole number.");
    const threshold = optInt(fd, "threshold");
    const row = await adjustStock({ variantId: uuid.parse(str(fd, "variantId")), mode, value, note: optStr(fd, "note"), actorId: actor.id, lowStockThreshold: threshold ?? undefined });
    await audit({ actorId: actor.id, action: "inventory.adjust", entityType: "variant", entityId: row.variantId, metadata: { mode, value, onHand: row.onHand } });
    clearCatalogCache();
    revalidatePath("/", "layout");
    return { message: `Stock updated — ${row.onHand} on hand` };
  });
}

/* ───────────────────────────── Taxonomy ───────────────────────────── */

export async function saveCategoryAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("products.manage");
    await saveCategory({ name: str(fd, "name"), description: optStr(fd, "description"), keywords: optStr(fd, "keywords"), sortOrder: str(fd, "sortOrder") || 0, isActive: bool(fd, "isActive") }, actor.id, optStr(fd, "id"));
    revalidatePath("/", "layout");
    return { message: "Category saved" };
  });
}
export async function saveBrandAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("products.manage");
    await saveBrand({ name: str(fd, "name"), isActive: bool(fd, "isActive") }, actor.id, optStr(fd, "id"));
    revalidatePath("/", "layout");
    return { message: "Brand saved" };
  });
}
export async function saveDeviceAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("products.manage");
    await saveDevice({ brandId: str(fd, "brandId"), name: str(fd, "name"), modelNumbers: optStr(fd, "modelNumbers"), aliases: optStr(fd, "aliases"), isActive: bool(fd, "isActive") }, actor.id, optStr(fd, "id"));
    revalidatePath("/", "layout");
    return { message: "Device model saved" };
  });
}

/* ───────────────────────────── Orders ───────────────────────────── */

export async function orderStatusAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("orders.manage");
    const orderId = uuid.parse(str(fd, "orderId"));
    const to = str(fd, "to") as OrderStatus;
    if (to === "CANCELLED") await cancelOrder(orderId, { user: actor }, str(fd, "note") || "Cancelled by staff");
    else await updateFulfilmentStatus(orderId, to, actor, { note: optStr(fd, "note"), carrier: optStr(fd, "carrier"), trackingNumber: optStr(fd, "trackingNumber"), trackingUrl: optStr(fd, "trackingUrl") });
    revalidatePath("/admin", "layout");
    return { message: "Order updated" };
  });
}

export async function refundDecisionAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("payments.manage");
    const approve = str(fd, "decision") === "approve";
    await decideRefund(uuid.parse(str(fd, "refundId")), actor, { approve, note: optStr(fd, "note"), restock: bool(fd, "restock") });
    revalidatePath("/admin", "layout");
    return { message: approve ? "Refund processed with the payment provider" : "Refund request declined" };
  });
}

/** Re-checks a payment with the gateway. Staff cannot mark an order paid by hand. */
export async function verifyPaymentAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("payments.manage");
    const reference = z.string().min(6).max(80).parse(str(fd, "reference"));
    const { outcome } = await verifyPayment(reference, `staff:${actor.id}`);
    await audit({ actorId: actor.id, action: "payment.verify", entityType: "payment", entityId: reference, metadata: { outcome } });
    revalidatePath("/admin", "layout");
    return { message: `Gateway result: ${outcome.replace(/_/g, " ").toLowerCase()}` };
  });
}

export async function runMaintenanceAction(): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("payments.manage");
    const r = await reconcilePayments();
    const sent = await dispatchQueuedNotifications(50);
    await audit({ actorId: actor.id, action: "maintenance.run", entityType: "system", metadata: { ...r, notifications: sent } });
    revalidatePath("/admin", "layout");
    return { message: `Checked ${r.checked} payment(s): ${r.paid} confirmed, ${r.expired} expired, ${r.cancelledOrders} order(s) released.` };
  });
}

/* ───────────────────────────── Customers ───────────────────────────── */

export async function wholesaleDecisionAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("customers.manage");
    const approve = str(fd, "decision") === "approve";
    await decideWholesale(uuid.parse(str(fd, "applicationId")), actor, { approve, note: optStr(fd, "note"), groupId: approve ? uuidOrNull(fd, "groupId") : undefined });
    revalidatePath("/admin", "layout");
    return { message: approve ? "Wholesale account approved" : "Application declined" };
  });
}

export async function updateCustomerAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("customers.manage");
    const patch: Record<string, unknown> = {};
    if (fd.has("wholesaleStatus")) patch.wholesaleStatus = str(fd, "wholesaleStatus");
    if (fd.has("groupId")) patch.groupId = uuidOrNull(fd, "groupId");
    if (fd.has("suspend")) patch.isSuspended = str(fd, "suspend") === "true";
    if (fd.has("role")) patch.role = str(fd, "role");
    await updateCustomer(uuid.parse(str(fd, "userId")), actor, patch);
    revalidatePath("/admin", "layout");
    return { message: "Customer updated" };
  });
}

export async function saveGroupAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("customers.manage");
    await saveGroup(str(fd, "name"), optStr(fd, "description") ?? null, actor.id);
    revalidatePath("/admin", "layout");
    return { message: "Customer group created" };
  });
}

export async function saveRuleAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("customers.manage");
    const priceType = z.enum(["FIXED", "PERCENT_OFF"]).parse(str(fd, "priceType"));
    const value = priceType === "FIXED" ? kobo(fd, "value") : optInt(fd, "value");
    if (value === null || !Number.isFinite(value)) throw new AppError(priceType === "FIXED" ? "Enter the unit price in naira." : "Enter the percentage off.");
    await saveRule({ name: str(fd, "name"), productId: uuidOrNull(fd, "productId"), categoryId: uuidOrNull(fd, "categoryId"), groupId: uuidOrNull(fd, "groupId"), minQuantity: int(fd, "minQuantity", 1), priceType, value, isActive: true }, actor.id);
    revalidatePath("/", "layout");
    return { message: "Price rule saved" };
  });
}
export async function deleteRuleAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("customers.manage");
    await deleteRule(uuid.parse(str(fd, "id")), actor.id);
    revalidatePath("/", "layout");
    return { message: "Price rule removed" };
  });
}

/* ───────────────────────────── Marketing ───────────────────────────── */

export async function saveCouponAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("marketing.manage");
    const type = z.enum(["PERCENT", "FIXED", "FREE_SHIPPING"]).parse(str(fd, "type"));
    const value = type === "FIXED" ? kobo(fd, "value") : type === "PERCENT" ? optInt(fd, "value") : 0;
    if (value === null || !Number.isFinite(value)) throw new AppError("Enter the discount value.");
    const money = (k: string) => {
      const v = kobo(fd, k);
      if (v !== null && !Number.isFinite(v)) throw new AppError("Enter amounts as numbers, e.g. 5000.");
      return v;
    };
    await saveCoupon({ code: str(fd, "code"), description: optStr(fd, "description"), type, value, minSubtotal: money("minSubtotal") ?? 0, maxDiscount: money("maxDiscount"), usageLimit: optInt(fd, "usageLimit"), perCustomerLimit: optInt(fd, "perCustomerLimit"), startsAt: optDate(fd, "startsAt"), endsAt: optDate(fd, "endsAt"), appliesToWholesale: bool(fd, "appliesToWholesale"), isActive: bool(fd, "isActive") }, actor.id, optStr(fd, "id"));
    revalidatePath("/admin/marketing");
    return { message: "Coupon saved" };
  });
}

export async function moderateReviewAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("marketing.manage");
    const status = z.enum(["APPROVED", "REJECTED"]).parse(str(fd, "status"));
    await moderateReview(uuid.parse(str(fd, "id")), status, actor.id);
    revalidatePath("/", "layout");
    return { message: status === "APPROVED" ? "Review published" : "Review rejected" };
  });
}

/* ───────────────────────────── Shipping ───────────────────────────── */

export async function saveZoneAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("settings.manage");
    const states = bool(fd, "allOther") ? ["*"] : fd.getAll("states").map(String);
    await saveZone({ name: str(fd, "name"), states, isActive: bool(fd, "isActive") }, actor.id, optStr(fd, "id"));
    revalidatePath("/admin/shipping");
    return { message: "Delivery zone saved" };
  });
}
export async function saveMethodAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("settings.manage");
    const base = kobo(fd, "baseFee"), per = kobo(fd, "perItemFee"), free = kobo(fd, "freeAbove");
    if (base === null || [base, per ?? 0, free ?? 1].some((v) => !Number.isFinite(v))) throw new AppError("Enter fees as numbers, e.g. 2500.");
    await saveMethod({ zoneId: str(fd, "zoneId"), name: str(fd, "name"), description: optStr(fd, "description"), baseFee: base, perItemFee: per ?? 0, freeAbove: free, etaMinDays: int(fd, "etaMinDays"), etaMaxDays: int(fd, "etaMaxDays"), isActive: bool(fd, "isActive") }, actor.id, optStr(fd, "id"));
    revalidatePath("/admin/shipping");
    return { message: "Delivery method saved" };
  });
}

/* ───────────────────────────── Support & AI ───────────────────────────── */

export async function updateTicketAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("support.manage");
    const status = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional().parse(optStr(fd, "status"));
    await updateTicket(uuid.parse(str(fd, "id")), actor, { status, internalNotes: fd.has("internalNotes") ? str(fd, "internalNotes") : undefined, assignToMe: bool(fd, "assignToMe") });
    revalidatePath("/admin", "layout");
    return { message: "Ticket updated" };
  });
}

/** A human agent replies inside the customer's chat conversation. */
export async function agentReplyAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("support.manage");
    const content = z.string().trim().min(1, "Type a reply").max(2000).parse(str(fd, "content"));
    await postAgentMessage(uuid.parse(str(fd, "conversationId")), actor, content);
    revalidatePath("/admin", "layout");
    return { message: "Reply sent to the customer's chat" };
  });
}

export async function dismissUnresolvedAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("ai.manage");
    await resolveUnresolved(uuid.parse(str(fd, "id")), actor.id);
    revalidatePath("/admin/ai", "layout");
    return { message: "Marked as handled" };
  });
}

export async function saveKnowledgeAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("ai.manage");
    await saveKnowledge({ title: str(fd, "title"), type: str(fd, "type") as never, content: str(fd, "content"), isPublished: bool(fd, "isPublished"), sortOrder: str(fd, "sortOrder") || 0 }, actor.id, optStr(fd, "id"));
    revalidatePath("/", "layout");
    return { message: "Knowledge base updated — the assistant uses it immediately" };
  });
}
export async function deleteKnowledgeAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("ai.manage");
    await deleteKnowledge(uuid.parse(str(fd, "id")), actor.id);
    revalidatePath("/", "layout");
    return { message: "Entry deleted" };
  });
}

const num = (fd: FormData, k: string, min: number, max: number, label: string) => {
  const v = Number(str(fd, k));
  if (!Number.isFinite(v) || v < min || v > max) throw new AppError(`${label} must be between ${min} and ${max}.`);
  return v;
};

export async function saveAiSettingsAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("ai.manage");
    const baseUrl = str(fd, "baseUrl");
    if (baseUrl && !/^https:\/\//.test(baseUrl)) throw new AppError("The custom API URL must start with https://");
    await updateSetting("ai", {
      enabled: bool(fd, "enabled"), orderingEnabled: bool(fd, "orderingEnabled"),
      provider: z.enum(["builtin", "agnes", "openai", "custom"]).parse(str(fd, "provider")),
      model: z.string().trim().min(1, "Enter a model name").max(80).parse(str(fd, "model")), baseUrl,
      temperature: num(fd, "temperature", 0, 1, "Temperature"), maxTokens: Math.round(num(fd, "maxTokens", 100, 4000, "Max tokens")),
      costPer1kPromptUsd: num(fd, "costPer1kPromptUsd", 0, 10, "Prompt cost"), costPer1kCompletionUsd: num(fd, "costPer1kCompletionUsd", 0, 10, "Completion cost"),
      extraInstructions: str(fd, "extraInstructions").slice(0, 2000),
    }, actor.id);
    await audit({ actorId: actor.id, action: "settings.ai", entityType: "settings", entityId: "ai", metadata: { provider: str(fd, "provider"), model: str(fd, "model"), enabled: bool(fd, "enabled"), orderingEnabled: bool(fd, "orderingEnabled") } });
    revalidatePath("/", "layout");
    return { message: "AI settings saved" };
  });
}

/* ───────────────────────────── Business settings ───────────────────────────── */

export async function saveStoreSettingsAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("settings.manage");
    const t = (k: string, max = 200) => str(fd, k).slice(0, max);
    const logoUrl = t("logoUrl", 500);
    if (logoUrl && !/^(https:\/\/|\/)/.test(logoUrl)) throw new AppError("The logo must be an https URL.");
    await updateSetting("store", { name: z.string().min(2, "Enter the store name").parse(t("name", 60)), tagline: t("tagline", 120), legalName: t("legalName", 160), supportEmail: z.string().email("Enter a valid support email").parse(t("supportEmail")), supportPhone: t("supportPhone", 40), whatsapp: t("whatsapp", 40), address: t("address", 250), businessHours: t("businessHours", 160), logoUrl }, actor.id);
    await audit({ actorId: actor.id, action: "settings.store", entityType: "settings", entityId: "store" });
    revalidatePath("/", "layout");
    return { message: "Store information saved" };
  });
}

export async function savePaymentSettingsAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("settings.manage");
    const patch = { paystackEnabled: bool(fd, "paystackEnabled"), flutterwaveEnabled: bool(fd, "flutterwaveEnabled"), defaultProvider: z.enum(["PAYSTACK", "FLUTTERWAVE"]).parse(str(fd, "defaultProvider")), paymentWindowMinutes: Math.round(num(fd, "paymentWindowMinutes", 10, 1440, "Payment window")) };
    if (!patch.paystackEnabled && !patch.flutterwaveEnabled) throw new AppError("Keep at least one payment gateway enabled, otherwise customers cannot pay.");
    await updateSetting("payments", patch, actor.id);
    await updateSetting("tax", { ratePercent: num(fd, "ratePercent", 0, 50, "Tax rate"), pricesIncludeTax: bool(fd, "pricesIncludeTax"), label: str(fd, "taxLabel").slice(0, 20) || "VAT" }, actor.id);
    await audit({ actorId: actor.id, action: "settings.payments", entityType: "settings", entityId: "payments", metadata: patch });
    revalidatePath("/", "layout");
    return { message: "Payment and tax settings saved" };
  });
}

export async function saveNotificationSettingsAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("settings.manage");
    const email = (k: string) => {
      const v = str(fd, k);
      if (v && !z.string().email().safeParse(v).success) throw new AppError("Enter a valid email address for staff alerts.");
      return v;
    };
    const templates: Record<string, { subject?: string; intro?: string }> = {};
    for (const key of fd.getAll("templateKey").map(String)) {
      const subject = str(fd, `subject:${key}`).slice(0, 200), intro = str(fd, `intro:${key}`).slice(0, 1500);
      if (subject || intro) templates[key] = { ...(subject ? { subject } : {}), ...(intro ? { intro } : {}) };
    }
    await updateSetting("notifications", { lowStockEmail: email("lowStockEmail"), newOrderEmail: email("newOrderEmail"), emailEnabled: bool(fd, "emailEnabled"), whatsappEnabled: bool(fd, "whatsappEnabled"), templates }, actor.id);
    await audit({ actorId: actor.id, action: "settings.notifications", entityType: "settings", entityId: "notifications" });
    return { message: "Notification settings saved" };
  });
}

/* ───────────────────────────── Procurement ───────────────────────────── */

export async function createSupplierAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("inventory.manage");
    await createSupplier({
      name: str(fd, "name"),
      contactName: optStr(fd, "contactName"),
      email: optStr(fd, "email"),
      phone: optStr(fd, "phone"),
      address: optStr(fd, "address"),
      leadTimeDays: optInt(fd, "leadTimeDays") ?? undefined,
      paymentTerms: optStr(fd, "paymentTerms"),
      notes: optStr(fd, "notes"),
    }, actor.id);
    revalidatePath("/admin/suppliers");
    return { message: "Supplier created" };
  });
}

export async function createWarehouseAction(_p: S, fd: FormData): Promise<S> {
  return runAction(async () => {
    const actor = await requirePermission("inventory.manage");
    await createWarehouse({
      name: str(fd, "name"),
      code: str(fd, "code"),
      address: optStr(fd, "address"),
      city: optStr(fd, "city"),
      state: optStr(fd, "state"),
      isDefault: bool(fd, "isDefault"),
    }, actor.id);
    revalidatePath("/admin/suppliers");
    revalidatePath("/admin/inventory");
    return { message: "Warehouse created" };
  });
}
