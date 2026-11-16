export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
] as const;

export type NigerianState = (typeof NIGERIAN_STATES)[number];

const STATE_ALIASES: Record<string, NigerianState> = { abuja: "FCT", "federal capital territory": "FCT", "fct abuja": "FCT", "abuja fct": "FCT", "port harcourt": "Rivers", ph: "Rivers", ibadan: "Oyo", benin: "Edo" };

/** Resolves free text ("lagos state", "Abuja") to a canonical state name. */
export function resolveState(input: string): NigerianState | null {
  const s = input.trim().toLowerCase().replace(/\s+state$/, "").replace(/\s+/g, " ");
  if (!s) return null;
  const direct = NIGERIAN_STATES.find((n) => n.toLowerCase() === s);
  return direct ?? STATE_ALIASES[s] ?? null;
}

/** Finds a state mentioned anywhere in a sentence. */
export function findStateInText(text: string): NigerianState | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ")} `;
  for (const n of [...NIGERIAN_STATES].sort((a, b) => b.length - a.length)) if (t.includes(` ${n.toLowerCase()} `)) return n;
  for (const [alias, n] of Object.entries(STATE_ALIASES)) if (alias.length > 2 && t.includes(` ${alias} `)) return n;
  return null;
}

/**
 * Normalises a Nigerian mobile number to E.164 (+234XXXXXXXXXX).
 * Accepts 0803…, 803…, 234803…, +234803… with spaces/dashes. Returns null when invalid.
 */
export function normalizeNigerianPhone(input: string): string | null {
  let d = input.replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("234")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1); // +234 0803…
  // Mobile numbers: 10 digits starting 70x, 71x, 80x, 81x, 90x, 91x
  if (!/^(70|71|80|81|90|91)\d{8}$/.test(d)) return null;
  return `+234${d}`;
}

export function displayPhone(e164: string): string {
  return e164.startsWith("+234") ? `0${e164.slice(4)}` : e164;
}
