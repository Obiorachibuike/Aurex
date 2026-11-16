import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/ui/bits";
import { simStore } from "@/lib/dev/paystack-sim";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Payment simulator", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Development / test stand-in for the Paystack hosted checkout page.
 * Only reachable when ENABLE_PAYMENT_SIMULATOR=true; it never exists in a production configuration.
 */
export default async function SimulatorPage({ params, searchParams }: { params: Promise<{ reference: string }>; searchParams: Promise<{ closed?: string }> }) {
  if (!env.paymentSimulatorEnabled) notFound();
  const { reference } = await params;
  const { closed } = await searchParams;
  const tx = simStore().get(reference);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-6 flex justify-center"><Logo /></div>
      <div className="panel p-6">
        <p className="badge badge-amber">Test mode — no real money moves</p>
        <h1 className="mt-4 text-xl font-semibold">Payment simulator</h1>
        <p className="mt-1.5 text-sm text-muted">This page stands in for the Paystack checkout while no live gateway keys are configured.</p>
        {!tx ? (
          <p className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-[#ffc9cd]">This payment session was not found. It may have expired — go back to your order and choose “Pay now” again.</p>
        ) : closed ? (
          <p data-testid="sim-closed" className="mt-6 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm text-muted">Payment recorded at the gateway. The shopper never returned to the store — the webhook alone must confirm this order. You can close this tab.</p>
        ) : (
          <>
            <dl className="mt-6 space-y-2 border-y border-line py-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Amount</dt><dd data-testid="sim-amount" className="font-semibold text-gold-bright tabular-nums">{formatMoney(tx.amount)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Email</dt><dd className="truncate">{tx.email}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Reference</dt><dd className="truncate font-mono text-xs">{tx.reference}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Status</dt><dd>{tx.status}</dd></div>
            </dl>
            <form action="/api/dev/paystack-sim/complete" method="post" className="mt-5 space-y-2.5">
              <input type="hidden" name="reference" value={tx.reference} />
              <button name="outcome" value="success" data-testid="sim-pay-success" className="btn btn-gold w-full">Pay successfully</button>
              <button name="outcome" value="failed" data-testid="sim-pay-fail" className="btn btn-outline w-full">Decline payment</button>
              <button name="outcome" value="success_no_return" data-testid="sim-pay-noreturn" className="btn btn-ghost w-full text-xs">Pay, but don&apos;t return to the store (webhook only)</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
