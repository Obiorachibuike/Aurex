import { asc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { shippingMethods, shippingZones } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { computeShippingFee, matchZone } from "./totals";

export type ShippingOption = {
  id: string;
  name: string;
  description: string | null;
  zone: string;
  provider: string;
  fee: number;
  etaMinDays: number;
  etaMaxDays: number;
  etaText: string;
};

type MethodRow = typeof shippingMethods.$inferSelect;
type QuoteContext = { itemCount: number; subtotal: number; freeShipping?: boolean; state: string };

/**
 * Logistics provider abstraction. "manual" uses the admin-configured zone tables.
 * To integrate a carrier (GIG, Kwik, DHL…), implement this interface and register it below,
 * then set a shipping method's `provider` to the new key.
 */
export interface ShippingProvider {
  key: string;
  quote(method: MethodRow, ctx: QuoteContext): Promise<{ fee: number; etaMinDays: number; etaMaxDays: number }>;
  /** Optional: book a shipment with the carrier and return tracking details. */
  createShipment?(order: { number: string }): Promise<{ carrier: string; trackingNumber: string; trackingUrl?: string }>;
}

const manualProvider: ShippingProvider = {
  key: "manual",
  async quote(method, ctx) {
    return { fee: computeShippingFee(method, ctx), etaMinDays: method.etaMinDays, etaMaxDays: method.etaMaxDays };
  },
};

const providers = new Map<string, ShippingProvider>([[manualProvider.key, manualProvider]]);
export function registerShippingProvider(p: ShippingProvider) {
  providers.set(p.key, p);
}

export function etaText(min: number, max: number): string {
  if (max <= 0) return "Same day";
  return min === max ? `${min} business day${min === 1 ? "" : "s"}` : `${min}–${max} business days`;
}

export async function getShippingOptions(ctx: QuoteContext, conn: DbOrTx = db): Promise<ShippingOption[]> {
  const zones = await conn.select().from(shippingZones);
  const zone = matchZone(zones, ctx.state);
  if (!zone) return [];
  const methods = await conn.select().from(shippingMethods).where(eq(shippingMethods.zoneId, zone.id)).orderBy(asc(shippingMethods.baseFee));
  const out: ShippingOption[] = [];
  for (const m of methods.filter((x) => x.isActive)) {
    const provider = providers.get(m.provider) ?? manualProvider;
    const q = await provider.quote(m, ctx);
    out.push({ id: m.id, name: m.name, description: m.description, zone: zone.name, provider: m.provider, fee: q.fee, etaMinDays: q.etaMinDays, etaMaxDays: q.etaMaxDays, etaText: etaText(q.etaMinDays, q.etaMaxDays) });
  }
  return out;
}

/** Validates that the chosen method really serves the destination state and returns its server-side quote. */
export async function quoteShipping(methodId: string, ctx: QuoteContext, conn: DbOrTx = db): Promise<ShippingOption> {
  const option = (await getShippingOptions(ctx, conn)).find((o) => o.id === methodId);
  if (!option) throw new AppError("That delivery method is not available for the selected state.", "SHIPPING_UNAVAILABLE");
  return option;
}
