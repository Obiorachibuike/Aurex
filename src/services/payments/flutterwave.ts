import { hmacHex, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { GatewayError, type PaymentGateway, type VerificationResult } from "./types";

type Envelope<T> = { status: string; message: string; data: T };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.flutterwave.apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.flutterwave.secretKey}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || json?.status !== "success") throw new GatewayError(json?.message ?? `Flutterwave responded ${res.status}`, res.status);
  return json.data;
}

/** Flutterwave (v3 Standard). Amounts are sent/received in major units and converted here. */
export const flutterwaveGateway: PaymentGateway = {
  provider: "FLUTTERWAVE",
  label: "Flutterwave",
  isConfigured: () => !!env.flutterwave.secretKey,

  async initialize(input) {
    const data = await call<{ link: string }>("/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: (input.amount / 100).toFixed(2),
        currency: input.currency,
        redirect_url: input.callbackUrl,
        customer: { email: input.email, name: input.customerName, phonenumber: input.phone },
        meta: input.metadata,
        customizations: { title: "AUREX", description: `Order ${input.metadata.order_number ?? ""}`.trim() },
      }),
    });
    return { authorizationUrl: data.link };
  },

  async verify(reference): Promise<VerificationResult> {
    let data: { id: number; tx_ref: string; status: string; amount: number; currency: string; payment_type?: string; created_at?: string; processor_response?: string };
    try {
      data = await call(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    } catch (e) {
      if (e instanceof GatewayError && (e.status === 400 || e.status === 404)) return { status: "abandoned", reference, amount: 0, currency: "", transactionId: null, channel: null, paidAt: null, message: e.message };
      throw e;
    }
    const status = data.status === "successful" ? "success" : data.status === "failed" ? "failed" : "pending";
    return { status, reference: data.tx_ref, amount: Math.round(data.amount * 100), currency: data.currency, transactionId: String(data.id), channel: data.payment_type ?? null, paidAt: status === "success" ? new Date(data.created_at ?? Date.now()) : null, message: data.processor_response ?? null };
  },

  parseWebhook(rawBody, headers) {
    const hash = headers.get("verif-hash");
    if (!hash || !env.flutterwave.webhookHash || !safeEqual(hash, env.flutterwave.webhookHash)) return null;
    let body: { event?: string; data?: { id?: number; tx_ref?: string; status?: string } };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const eventType = String(body.event ?? "unknown");
    return { eventKey: `${eventType}:${body.data?.id ?? hmacHex("sha256", "k", rawBody)}:${body.data?.status ?? ""}`, eventType, reference: body.data?.tx_ref ?? null, isChargeEvent: eventType.startsWith("charge.") };
  },

  async refund({ transactionId, amount }) {
    if (!transactionId) throw new GatewayError("Missing Flutterwave transaction id for refund.");
    const data = await call<{ id?: number; status?: string }>(`/transactions/${encodeURIComponent(transactionId)}/refund`, { method: "POST", body: JSON.stringify({ amount: amount / 100 }) });
    return { providerReference: data.id ? String(data.id) : null, status: data.status ?? "pending" };
  },
};
