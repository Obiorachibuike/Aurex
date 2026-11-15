import type { Metadata } from "next";
import Link from "next/link";
import { refundDecisionAction, runMaintenanceAction, verifyPaymentAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { listPaymentsAdmin } from "@/services/admin";
import { listOpenRefunds } from "@/services/orders";
import { getAvailableProviders } from "@/services/payments";

export const metadata: Metadata = { title: "Payments & refunds" };

export default async function PaymentsAdmin() {
  await requireStaffPage("payments.manage");
  const [rows, refunds, providers] = await Promise.all([listPaymentsAdmin(100), listOpenRefunds(), getAvailableProviders()]);
  return (
    <>
      <AdminHeader
        title="Payments & refunds"
        description={providers.length ? `Active gateway(s): ${providers.map((p) => p.label).join(", ")}. Payments are confirmed by webhook and re-verified with the gateway.` : "No payment gateway is configured — customers cannot pay yet. Add gateway keys (see README)."}
        actions={<ActionForm action={async () => { "use server"; return runMaintenanceAction(); }}><SubmitButton className="btn-outline" pendingLabel="Checking…">Reconcile pending payments</SubmitButton></ActionForm>}
      />
      {refunds.length ? (
        <Section title={`Refund requests (${refunds.length})`} className="mb-6">
          <ul className="divide-y divide-line">
            {refunds.map(({ refund: r, orderNumber, customerName }) => (
              <li key={r.id} className="px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span><Link href={`/admin/orders/${r.orderId}`} className="link font-mono">{orderNumber}</Link> · {customerName} · <span className="tabular-nums">{formatMoney(r.amount)}</span></span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1.5 text-muted">{r.reason}</p>
                {r.status === "REQUESTED" ? (
                  <ActionForm action={refundDecisionAction} className="mt-3 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="refundId" value={r.id} />
                    <input name="note" aria-label="Note" placeholder="Note (optional)" className="input max-w-xs" />
                    <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="restock" className="check" /> Restock items</label>
                    <SubmitButton name="decision" value="approve" className="btn-sm" confirm={`Refund ${formatMoney(r.amount)} through the payment provider?`}>Approve & refund</SubmitButton>
                    <SubmitButton name="decision" value="reject" className="btn-outline btn-sm">Decline</SubmitButton>
                  </ActionForm>
                ) : <p className="mt-2 text-xs text-warning">Approved but the gateway refund has not completed — open the order to retry.</p>}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead><tr><th>Reference</th><th>Order</th><th>Gateway</th><th>Status</th><th className="text-right">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map(({ payment: p, orderNumber, customer }) => (
              <tr key={p.id}>
                <td><span className="font-mono text-xs">{p.reference}</span><div className="text-[11px] text-faint">{formatDate(p.createdAt, true)}</div></td>
                <td><Link href={`/admin/orders/${p.orderId}`} className="link font-mono text-xs">{orderNumber}</Link><div className="text-xs text-faint">{customer}</div></td>
                <td className="text-muted">{p.provider}{p.channel ? ` · ${p.channel}` : ""}</td>
                <td><StatusBadge status={p.status} /></td>
                <td className="text-right tabular-nums">{formatMoney(p.amount)}</td>
                <td>{["PENDING", "INITIALIZED", "FAILED", "REQUIRES_REVIEW"].includes(p.status) ? <ActionForm action={verifyPaymentAction} className="flex justify-end"><input type="hidden" name="reference" value={p.reference} /><SubmitButton className="btn-ghost btn-sm">Re-check</SubmitButton></ActionForm> : null}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={6} className="py-10 text-center text-muted">No payments yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
