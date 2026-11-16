import { NextResponse } from "next/server";
import { reportError } from "@/lib/monitoring";
import { handleWebhook } from "@/services/payments";
import { dispatchQueuedNotifications } from "@/services/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PROVIDERS = { paystack: "PAYSTACK", flutterwave: "FLUTTERWAVE" } as const;

/**
 * Payment gateway webhooks. The raw body is verified against the provider signature, stored
 * once (idempotent), and the payment is then re-verified server-to-server before any order
 * changes. A 5xx tells the gateway to retry; duplicates are acknowledged with 200.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = PROVIDERS[(await params).provider as keyof typeof PROVIDERS];
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 200_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  try {
    const result = await handleWebhook(provider, raw, req.headers);
    if (result.status === "invalid_signature") return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    if (result.status === "processed") await dispatchQueuedNotifications(10).catch((e) => reportError(e, { where: "webhook.notify" }));
    return NextResponse.json({ received: true, status: result.status });
  } catch (e) {
    reportError(e, { where: "webhook", provider });
    return NextResponse.json({ error: "Temporary failure" }, { status: 500 });
  }
}
