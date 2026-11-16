import { hmacHex } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * In-memory stand-in for the Paystack API, for local development, demos and end-to-end tests
 * when real Paystack test keys / network access are not available.
 *
 * It speaks the same HTTP contract the real adapter uses (initialize, verify, refund, signed
 * `charge.success` webhooks), so the production code path — including signature verification
 * and server-side re-verification — is exercised unchanged. Point the adapter at it with:
 *   ENABLE_PAYMENT_SIMULATOR=true
 *   PAYSTACK_API_URL=http://127.0.0.1:3000/api/dev/paystack-sim
 *   PAYSTACK_SECRET_KEY=sk_test_simulator   (any value; it signs the simulated webhooks)
 * It is hard-disabled on Vercel production deployments.
 */
export type SimTransaction = {
  id: number;
  reference: string;
  amount: number;
  currency: string;
  email: string;
  callbackUrl: string;
  status: "pending" | "success" | "failed" | "abandoned";
  paidAt: string | null;
  refunded: number;
};

const g = globalThis as unknown as { __aurexPaystackSim?: Map<string, SimTransaction> };
export const simStore = (): Map<string, SimTransaction> => (g.__aurexPaystackSim ??= new Map());

export function simInternalBase(): string {
  return (process.env.SIMULATOR_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
}

/** Marks the simulated transaction and (like Paystack) notifies the store by signed webhook. */
export async function settleSimTransaction(reference: string, outcome: "success" | "failed"): Promise<SimTransaction | null> {
  const tx = simStore().get(reference);
  if (!tx) return null;
  if (tx.status === "pending") {
    tx.status = outcome;
    tx.paidAt = outcome === "success" ? new Date().toISOString() : null;
  }
  const body = JSON.stringify({ event: tx.status === "success" ? "charge.success" : "charge.failed", data: { id: tx.id, reference: tx.reference, amount: tx.amount, currency: tx.currency, status: tx.status } });
  try {
    await fetch(`${simInternalBase()}/api/webhooks/paystack`, { method: "POST", headers: { "content-type": "application/json", "x-paystack-signature": hmacHex("sha512", env.paystack.secretKey, body) }, body, signal: AbortSignal.timeout(15_000) });
  } catch {
    // Like a real gateway, a missed webhook is not fatal: the callback and reconciliation job also verify.
  }
  return tx;
}
