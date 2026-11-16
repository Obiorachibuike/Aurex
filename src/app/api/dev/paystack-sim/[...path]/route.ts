import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { settleSimTransaction, simStore, type SimTransaction } from "@/lib/dev/paystack-sim";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ status: false, message: "Not found" }, { status: 404 });
const ok = (data: unknown, message = "OK") => NextResponse.json({ status: true, message, data });
const fail = (message: string, status = 400) => NextResponse.json({ status: false, message }, { status });

function authorised(req: Request): boolean {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return !!env.paystack.secretKey && safeEqual(key, env.paystack.secretKey);
}
const view = (t: SimTransaction) => ({ id: t.id, status: t.status, reference: t.reference, amount: t.amount, currency: t.currency, channel: "card", paid_at: t.paidAt, gateway_response: t.status === "success" ? "Successful" : t.status === "failed" ? "Declined" : "Pending", customer: { email: t.email } });

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!env.paymentSimulatorEnabled) return notFound();
  const path = (await params).path;
  if (path[0] === "transaction" && path[1] === "verify" && path[2]) {
    if (!authorised(req)) return fail("Invalid key", 401);
    const t = simStore().get(decodeURIComponent(path[2]));
    return t ? ok(view(t), "Verification successful") : fail("Transaction reference not found", 400);
  }
  return notFound();
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!env.paymentSimulatorEnabled) return notFound();
  const path = (await params).path.join("/");

  if (path === "transaction/initialize") {
    if (!authorised(req)) return fail("Invalid key", 401);
    const b = (await req.json().catch(() => ({}))) as { reference?: string; amount?: number; currency?: string; email?: string; callback_url?: string };
    if (!b.reference || !Number.isInteger(b.amount) || (b.amount ?? 0) <= 0 || !b.email) return fail("Invalid initialize request");
    const store = simStore();
    if (store.has(b.reference)) return fail("Duplicate Transaction Reference");
    store.set(b.reference, { id: 4_000_000_000 + Math.floor(Math.random() * 900_000_000), reference: b.reference, amount: b.amount!, currency: b.currency ?? "NGN", email: b.email, callbackUrl: b.callback_url ?? "", status: "pending", paidAt: null, refunded: 0 });
    // Relative so it works behind any host/proxy; the real Paystack returns an absolute checkout URL.
    return ok({ authorization_url: `/dev/paystack/${encodeURIComponent(b.reference)}`, access_code: "sim", reference: b.reference }, "Authorization URL created");
  }

  if (path === "refund") {
    if (!authorised(req)) return fail("Invalid key", 401);
    const b = (await req.json().catch(() => ({}))) as { transaction?: string; amount?: number };
    const t = b.transaction ? simStore().get(b.transaction) : undefined;
    if (!t || t.status !== "success") return fail("Transaction not found or not successful");
    const amount = b.amount ?? t.amount;
    if (amount <= 0 || t.refunded + amount > t.amount) return fail("Refund amount exceeds the transaction amount");
    t.refunded += amount;
    return ok({ id: Math.floor(Math.random() * 1_000_000_000), status: "processed", amount }, "Refund has been queued for processing");
  }

  // Posted by the simulated hosted checkout page (browser form).
  if (path === "complete") {
    const form = await req.formData();
    const reference = String(form.get("reference") ?? "");
    const outcome = String(form.get("outcome") ?? "");
    const t = simStore().get(reference);
    if (!t) return notFound();
    if (outcome === "success" || outcome === "failed") await settleSimTransaction(reference, outcome);
    if (outcome === "success_no_return") {
      await settleSimTransaction(reference, "success");
      return new NextResponse(null, { status: 303, headers: { Location: `/dev/paystack/${encodeURIComponent(reference)}?closed=1` } });
    }
    return new NextResponse(null, { status: 303, headers: { Location: `/checkout/callback?provider=paystack&trxref=${encodeURIComponent(reference)}&reference=${encodeURIComponent(reference)}` } });
  }
  return notFound();
}
