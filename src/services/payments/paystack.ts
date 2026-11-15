import { hmacHex, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { GatewayError, type PaymentGateway, type VerificationResult } from "./types";

type Envelope<T> = { status: boolean; message: string; data: T };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.paystack.apiUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.paystack.secretKey}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json?.status) throw new GatewayError(json?.message ?? `Paystack responded ${res.status}`, res.status);
  return json.data;
}

export const paystackGateway: PaymentGateway = {
  provider: "PAYSTACK",
  label: "Paystack",
  isConfigured: () => !!env.paystack.secretKey,

  async initialize(input) {
    const data = await call<{ authorization_url: string; reference: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({ email: input.email, amount: input.amount, currency: input.currency, reference: input.reference, callback_url: input.callbackUrl, metadata: input.metadata }),
    });
    return { authorizationUrl: data.authorization_url };
  },

  async verify(reference): Promise<VerificationResult> {
    let data: { id: number | string; status: string; reference: string; amount: number; currency: string; channel?: string; paid_at?: string | null; gateway_response?: string };
    try {
      data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
    } catch (e) {
      // Paystack returns 400/404 for references it has never seen (customer never reached checkout).
      if (e instanceof GatewayError && (e.status === 400 || e.status === 404)) return { status: "abandoned", reference, amount: 0, currency: "", transactionId: null, channel: null, paidAt: null, message: e.message };
      throw e;
    }
    const status = data.status === "success" ? "success" : data.status === "failed" || data.status === "reversed" ? "failed" : data.status === "abandoned" ? "abandoned" : "pending";
    return { status, reference: data.reference, amount: data.amount, currency: data.currency, transactionId: String(data.id), channel: data.channel ?? null, paidAt: data.paid_at ? new Date(data.paid_at) : null, message: data.gateway_response ?? null };
  },

  parseWebhook(rawBody, headers) {
    const signature = headers.get("x-paystack-signature");
    if (!signature || !env.paystack.secretKey) return null;
    if (!safeEqual(hmacHex("sha512", env.paystack.secretKey, rawBody), signature)) return null;
    let body: { event?: string; data?: { id?: number | string; reference?: string; transaction_reference?: string } };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const eventType = String(body.event ?? "unknown");
    const reference = body.data?.reference ?? body.data?.transaction_reference ?? null;
    return { eventKey: `${eventType}:${body.data?.id ?? reference ?? hmacHex("sha256", "k", rawBody)}`, eventType, reference, isChargeEvent: eventType.startsWith("charge.") };
  },

  async refund({ reference, amount }) {
    const data = await call<{ id?: number; status?: string }>("/refund", { method: "POST", body: JSON.stringify({ transaction: reference, amount }) });
    return { providerReference: data.id ? String(data.id) : null, status: data.status ?? "pending" };
  },
};
