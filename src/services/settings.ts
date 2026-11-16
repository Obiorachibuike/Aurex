import { eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { storeSettings } from "@/db/schema";

export type AiProviderKey = "builtin" | "agnes" | "openai" | "custom";

export const SETTINGS_DEFAULTS = {
  store: {
    name: "AUREX",
    tagline: "Built for Performance.",
    legalName: "AUREX — A KodexTeck Company",
    supportEmail: "support@aurex.ng",
    supportPhone: "+234 800 000 0000",
    whatsapp: "",
    address: "Lagos, Nigeria",
    logoUrl: "",
    currency: "NGN",
    businessHours: "Monday – Saturday, 9:00am – 6:00pm WAT",
  },
  payments: {
    paystackEnabled: true,
    flutterwaveEnabled: false,
    defaultProvider: "PAYSTACK" as "PAYSTACK" | "FLUTTERWAVE",
    /** How long stock stays reserved for an unpaid order. */
    paymentWindowMinutes: 30,
  },
  tax: { ratePercent: 0, pricesIncludeTax: true, label: "VAT" },
  ai: {
    enabled: true,
    orderingEnabled: true,
    provider: "builtin" as AiProviderKey,
    model: "agnes-2.5-flash",
    baseUrl: "",
    temperature: 0.2,
    maxTokens: 700,
    /** USD per 1,000 tokens — used only for the cost estimate in the admin dashboard. */
    costPer1kPromptUsd: 0,
    costPer1kCompletionUsd: 0,
    extraInstructions: "",
  },
  notifications: {
    lowStockEmail: "",
    newOrderEmail: "",
    emailEnabled: true,
    /** Per-template overrides: { order_confirmation: { subject, intro } } */
    templates: {} as Record<string, { subject?: string; intro?: string }>,
  },
};

export type Settings = typeof SETTINGS_DEFAULTS;
export type SettingsKey = keyof Settings;

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 15_000;

export function clearSettingsCache() {
  cache.clear();
}

export async function getSetting<K extends SettingsKey>(key: K, conn: DbOrTx = db): Promise<Settings[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Settings[K];
  const [row] = await conn.select().from(storeSettings).where(eq(storeSettings.key, key)).limit(1);
  const value = { ...SETTINGS_DEFAULTS[key], ...((row?.value as object) ?? {}) } as Settings[K];
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function getAllSettings(): Promise<Settings> {
  const keys = Object.keys(SETTINGS_DEFAULTS) as SettingsKey[];
  const rows = await db.select().from(storeSettings).where(inArray(storeSettings.key, keys));
  const out = structuredClone(SETTINGS_DEFAULTS) as Record<string, object>;
  for (const r of rows) out[r.key] = { ...out[r.key], ...(r.value as object) };
  return out as Settings;
}

export async function updateSetting<K extends SettingsKey>(key: K, patch: Partial<Settings[K]>, actorId?: string | null): Promise<Settings[K]> {
  const current = await getSetting(key);
  const value = { ...current, ...patch };
  await db
    .insert(storeSettings)
    .values({ key, value, updatedBy: actorId ?? null })
    .onConflictDoUpdate({ target: storeSettings.key, set: { value, updatedBy: actorId ?? null, updatedAt: new Date() } });
  cache.delete(key);
  return value;
}
