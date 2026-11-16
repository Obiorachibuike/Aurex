import { normalizeText, resolveDevice, type DeviceRecord, type DeviceResolution } from "./compatibility";

export type CategoryRecord = { id: string; name: string; slug: string; keywords: string[] };

const STOPWORDS = new Set(
  "a an the for of to in on with and or i im me my we you your need needs want wants looking look find get buy purchase order please pls do does have has got is are it its this that some any can could would like show give sell stock available price cost how much what which phone phones mobile replacement replacements part parts new original one piece pieces pcs unit units hi hello hey good morning afternoon evening there also add put".split(" "),
);

export type ParsedQuery = {
  device: DeviceResolution;
  category: CategoryRecord | null;
  /** Remaining meaningful words that must match product text. */
  terms: string[];
};

function removePhrase(text: string, phrase: string): string {
  return ` ${text} `.replace(` ${phrase} `, " ").replace(/\s+/g, " ").trim();
}

/**
 * Splits a free-text shopping query into structured parts:
 * device model (via the compatibility resolver), category (via category keywords) and leftover terms.
 */
export function parseQuery(input: string, devices: DeviceRecord[], categories: CategoryRecord[]): ParsedQuery {
  let text = normalizeText(input);
  const device = resolveDevice(text, devices);
  if (device.status !== "none") text = removePhrase(text, device.matchedText);

  let category: CategoryRecord | null = null;
  let bestLen = 0;
  let bestPhrase = "";
  for (const c of categories) {
    const phrases = [c.name, ...c.keywords].map(normalizeText).filter(Boolean);
    for (const p of phrases) {
      const variants = p.endsWith("s") ? [p, p.slice(0, -1)] : [p, `${p}s`];
      for (const v of variants) {
        if (v.length > bestLen && ` ${text} `.includes(` ${v} `)) {
          bestLen = v.length;
          bestPhrase = v;
          category = c;
        }
      }
    }
  }
  if (category) text = removePhrase(text, bestPhrase);

  // Brand words that only repeat the resolved device brand add nothing.
  const brandWords = new Set<string>();
  if (device.status === "exact") normalizeText(device.device.brand).split(" ").forEach((w) => brandWords.add(w));
  if (device.status === "ambiguous") device.candidates.forEach((d) => normalizeText(d.brand).split(" ").forEach((w) => brandWords.add(w)));

  const terms = text.split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t) && !brandWords.has(t) && !/^\d+$/.test(t));
  return { device, category, terms };
}
