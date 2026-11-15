import { vi } from "vitest";
import { hmacHex } from "@/lib/crypto";

let nextId = 1000 + Math.floor(Math.random() * 1_000_000) * 10;
type Tx = { status: "success" | "failed" | "abandoned" | "ongoing"; amount: number; currency: string; id: number };

/**
 * In-memory stand-in for the Paystack and Flutterwave HTTP APIs. It replaces global fetch so the
 * real gateway adapters (request building, response parsing, error handling) are exercised.
 */
export function installFakeGateways() {
  const paystack = new Map<string, Tx>();
  const flutterwave = new Map<string, Tx>();
  const refunds: { provider: string; reference: string; amount: number }[] = [];
  const state = { failInitialize: false, failRefund: false, down: false, calls: [] as string[] };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    state.calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    if (state.down) throw new Error("network down");
    const auth = new Headers(init?.headers).get("authorization");
    if (url.host === "paystack.test") {
      if (auth !== `Bearer ${process.env.PAYSTACK_SECRET_KEY}`) return json({ status: false, message: "Invalid key" }, 401);
      if (url.pathname === "/transaction/initialize") {
        if (state.failInitialize) return json({ status: false, message: "Service unavailable" }, 503);
        paystack.set(body.reference, { status: "abandoned", amount: body.amount, currency: body.currency, id: nextId++ });
        return json({ status: true, message: "ok", data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, reference: body.reference } });
      }
      const m = url.pathname.match(/^\/transaction\/verify\/(.+)$/);
      if (m) {
        const t = paystack.get(decodeURIComponent(m[1]!));
        if (!t) return json({ status: false, message: "Transaction reference not found" }, 400);
        return json({ status: true, message: "ok", data: { id: t.id, status: t.status, reference: decodeURIComponent(m[1]!), amount: t.amount, currency: t.currency, channel: "card", paid_at: t.status === "success" ? new Date().toISOString() : null, gateway_response: t.status === "success" ? "Successful" : "Declined" } });
      }
      if (url.pathname === "/refund") {
        if (state.failRefund) return json({ status: false, message: "Refund not allowed" }, 400);
        refunds.push({ provider: "PAYSTACK", reference: body.transaction, amount: body.amount });
        return json({ status: true, message: "ok", data: { id: nextId++, status: "pending" } });
      }
    }
    if (url.host === "flutterwave.test") {
      if (url.pathname === "/v3/payments") {
        flutterwave.set(body.tx_ref, { status: "abandoned", amount: Math.round(Number(body.amount) * 100), currency: body.currency, id: nextId++ });
        return json({ status: "success", message: "ok", data: { link: `https://checkout.flutterwave.test/${body.tx_ref}` } });
      }
      if (url.pathname === "/v3/transactions/verify_by_reference") {
        const ref = url.searchParams.get("tx_ref")!;
        const t = flutterwave.get(ref);
        if (!t || t.status === "abandoned") return json({ status: "error", message: "No transaction was found for this id" }, 404);
        return json({ status: "success", message: "ok", data: { id: t.id, tx_ref: ref, status: t.status === "success" ? "successful" : "failed", amount: t.amount / 100, currency: t.currency, payment_type: "card", created_at: new Date().toISOString() } });
      }
      const r = url.pathname.match(/^\/v3\/transactions\/(\d+)\/refund$/);
      if (r) {
        refunds.push({ provider: "FLUTTERWAVE", reference: r[1]!, amount: Math.round(body.amount * 100) });
        return json({ status: "success", message: "ok", data: { id: nextId++, status: "completed" } });
      }
    }
    return json({ status: false, message: `Unhandled fake route ${url.href}` }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    state,
    refunds,
    paystack,
    flutterwave,
    /** Simulates the customer completing (or failing) payment on the gateway's hosted page. */
    settle(reference: string, status: Tx["status"], overrides: Partial<Tx> = {}) {
      const map = paystack.has(reference) ? paystack : flutterwave;
      const t = map.get(reference);
      if (!t) throw new Error(`unknown reference ${reference}`);
      map.set(reference, { ...t, ...overrides, status });
    },
    paystackWebhook(reference: string, event = "charge.success") {
      const t = paystack.get(reference);
      const raw = JSON.stringify({ event, data: { id: t?.id ?? 1, reference, amount: t?.amount, status: "success" } });
      return { raw, headers: new Headers({ "x-paystack-signature": hmacHex("sha512", process.env.PAYSTACK_SECRET_KEY!, raw) }) };
    },
    flutterwaveWebhook(reference: string) {
      const t = flutterwave.get(reference);
      const raw = JSON.stringify({ event: "charge.completed", data: { id: t?.id ?? 1, tx_ref: reference, status: "successful" } });
      return { raw, headers: new Headers({ "verif-hash": process.env.FLUTTERWAVE_WEBHOOK_HASH! }) };
    },
  };
}
