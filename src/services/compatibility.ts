/**
 * Structured device-compatibility matching.
 *
 * Products are linked to device models through the product_compatibility table. This module
 * resolves what a customer typed ("samsung a15 screen") to device model records. Product
 * recommendations are then made ONLY through those links — never by name similarity.
 */
export type DeviceRecord = {
  id: string;
  brand: string;
  name: string;
  modelNumbers: string[];
  aliases: string[];
};

export type DeviceResolution =
  | { status: "none" }
  | { status: "exact"; device: DeviceRecord; matchedText: string }
  | { status: "ambiguous"; candidates: DeviceRecord[]; matchedText: string };

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** All normalised phrases that identify a device, most specific first. */
export function deviceKeys(d: DeviceRecord): string[] {
  const keys = new Set<string>();
  const add = (s: string) => {
    const n = normalizeText(s);
    if (n) keys.add(n);
  };
  add(`${d.brand} ${d.name}`);
  add(d.name);
  for (const a of d.aliases) {
    add(a);
    add(`${d.brand} ${a}`);
  }
  for (const m of d.modelNumbers) {
    add(m);
    add(m.replace(/[^a-z0-9]/gi, ""));
  }
  return [...keys];
}

function containsPhrase(haystack: string, phrase: string): boolean {
  // Whole-token match so "a15" never matches "a155" or "a15s".
  return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * Finds the device(s) a piece of text refers to.
 * - The longest matching phrase wins ("a15 4g" beats "a15").
 * - If several devices share that longest phrase (e.g. the alias "A15" belongs to both the
 *   4G and 5G models) the result is ambiguous and the caller must ask the customer.
 */
export function resolveDevice(text: string, devices: DeviceRecord[]): DeviceResolution {
  const q = normalizeText(text);
  if (!q) return { status: "none" };
  let bestLen = 0;
  let bestPhrase = "";
  const best = new Map<string, DeviceRecord>();
  for (const d of devices) {
    for (const key of deviceKeys(d)) {
      if (key.length < 2 || !containsPhrase(q, key)) continue;
      if (key.length > bestLen) {
        bestLen = key.length;
        bestPhrase = key;
        best.clear();
        best.set(d.id, d);
      } else if (key.length === bestLen) {
        best.set(d.id, d);
      }
    }
  }
  if (best.size === 0) return { status: "none" };
  const candidates = [...best.values()];
  if (candidates.length === 1) return { status: "exact", device: candidates[0]!, matchedText: bestPhrase };
  return { status: "ambiguous", candidates, matchedText: bestPhrase };
}

/** A product fits a device only via an explicit compatibility link, or when it is universal. */
export function isCompatible(product: { isUniversal: boolean; compatibleDeviceIds: string[] }, deviceId: string): boolean {
  return product.isUniversal || product.compatibleDeviceIds.includes(deviceId);
}

export function deviceLabel(d: Pick<DeviceRecord, "brand" | "name">): string {
  return `${d.brand} ${d.name}`;
}
