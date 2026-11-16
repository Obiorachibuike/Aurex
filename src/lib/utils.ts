import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYMBOLS: Record<string, string> = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "GH₵", KES: "KSh" };

/** Formats integer minor units (kobo) as a currency string, e.g. 1250000 → ₦12,500. */
export function formatMoney(minor: number, currency = "NGN"): string {
  const major = minor / 100;
  const hasFraction = minor % 100 !== 0;
  const n = major.toLocaleString("en-NG", { minimumFractionDigits: hasFraction ? 2 : 0, maximumFractionDigits: 2 });
  return `${SYMBOLS[currency] ?? `${currency} `}${n}`;
}

/** Parses a major-unit amount typed by a human ("12,500.50") into minor units. Returns null when invalid. */
export function parseMoney(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₦,\s]/g, "");
  if (s === "" || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function formatDate(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Africa/Lagos",
  });
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
