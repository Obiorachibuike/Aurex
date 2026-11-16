import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orderStatusAction, refundDecisionAction, verifyPaymentAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { displayPhone } from "@/lib/nigeria";
import { formatDate, formatMoney } from "@/lib/utils";
import { hasPermission } from "@/services/auth";
import { FULFILMENT_TRANSITIONS, getOrderFull, ORDER_STATUS_LABELS } from "@/services/orders";

export const metadata: Metadata = { title: "Order" };

export default async function OrderAdmin({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("orders.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const o = await getOrderFull({ id });
  if (!o) notFound();
  const canManage = hasPermission(user, "orders.manage");
  const canPay = hasPermission(user, "payments.manage");
  const next = (FULFILMENT_TRANSITIONS[o.status] ?? []).filter((s) => s !== "CANCELLED");
  const canCancel = ["PENDING", "AWAITING_PAYMENT", "PAYMENT_FAILED"].includes(o.status);
  const a = o.shippingAddress;
  return (
    <>
      <AdminHeader title={`Order ${o.number}`} description={<>Placed {formatDate(o.createdAt, true)} · {o.source === "AI" ? "via AI assistant" : "via website"} · {o.pricingTier === "WHOLESALE" ? "wholesale pricing" : "retail pricing"}</>} actions={<><StatusBadge status={o.status} /><Link href="/admin/orders" className="btn btn-outline btn-sm">Back</Link></>} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Section title="Items">
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Item</th><th className="text-right">Unit</th><th className="text-right">Qty</th><th className="text-right">Total</th></tr></thead>
                <tbody>{o.items.map((i) => (<tr key={i.id}><td>{i.productName}<div className="text-xs text-faint"><span className="font-mono">{i.sku}</span>{i.variantName && i.variantName !== "Standard" ? ` · ${i.variantName}` : ""}</div></td><td className="text-right tabular-nums">{formatMoney(i.unitPrice)}</td><td className="text-right tabular-nums">{i.quantity}</td><td className="text-right tabular-nums">{formatMoney(i.lineTotal)}</td></tr>))}</tbody>
              </table>
            </div>
            <dl className="space-y-1.5 border-t border-line p-5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{formatMoney(o.subtotal)}</dd></div>
              {o.discountTotal ? <div className="flex justify-between"><dt className="text-muted">Discount{o.couponCode ? ` (${o.couponCode})` : ""}</dt><dd className="tabular-nums">−{formatMoney(o.discountTotal)}</dd></div> : null}
              <div className="flex justify-between"><dt className="text-muted">Delivery — {o.shippingMethod.name}</dt><dd className="tabular-nums">{formatMoney(o.shippingTotal)}</dd></div>
              {o.taxTotal ? <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular-nums">{formatMoney(o.taxTotal)}</dd></div> : null}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="text-gold-bright tabular-nums">{formatMoney(o.total)}</dd></div>
            </dl>
          </Section>

          <Section title="Payments">
            {o.payments.length ? (
              <ul className="divide-y divide-line">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div><p className="font-mono text-xs">{p.reference}</p><p className="text-xs text-faint">{p.provider} · {formatDate(p.createdAt, true)}{p.channel ? ` · ${p.channel}` : ""}{p.failureReason ? ` · ${p.failureReason}` : ""}</p></div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={p.status} /><span className="tabular-nums">{formatMoney(p.amount)}</span>
                      {canPay ? <ActionForm action={verifyPaymentAction}><input type="hidden" name="reference" value={p.reference} /><SubmitButton className="btn-outline btn-sm">Re-check with gateway</SubmitButton></ActionForm> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="p-5 text-sm text-muted">No payment attempts.</p>}
            <p className="border-t border-line px-5 py-3 text-xs text-faint">Orders are marked paid only by server-side gateway verification — they cannot be marked paid by hand.</p>
          </Section>

          {o.refunds.length ? (
            <Section title="Refunds">
              <ul className="divide-y divide-line">
                {o.refunds.map((r) => (
                  <li key={r.id} className="px-5 py-4 text-sm">
                    <div className="flex items-center justify-between gap-3"><span><StatusBadge status={r.status} /> <span className="ml-2 tabular-nums">{formatMoney(r.amount)}</span></span><span className="text-xs text-faint">{formatDate(r.createdAt, true)}</span></div>
                    <p className="mt-2 text-muted">{r.reason}</p>
                    {r.status === "REQUESTED" && canPay ? (
                      <ActionForm action={refundDecisionAction} className="mt-3 flex flex-wrap items-center gap-3">
                        <input type="hidden" name="refundId" value={r.id} />
                        <input name="note" aria-label="Note" placeholder="Note to the customer (optional)" className="input max-w-xs" />
                        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="restock" className="check" /> Items returned — put back in stock</label>
                        <SubmitButton name="decision" value="approve" className="btn-sm" confirm={`Refund ${formatMoney(r.amount)} through the payment provider?`}>Approve & refund</SubmitButton>
                        <SubmitButton name="decision" value="reject" className="btn-outline btn-sm">Decline</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title="History">
            <ol className="space-y-3 p-5 text-sm">
              {o.history.map((h) => (<li key={h.id} className="flex gap-3"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" aria-hidden /><div><p>{ORDER_STATUS_LABELS[h.toStatus] ?? h.toStatus}{h.note ? <span className="text-muted"> — {h.note}</span> : null}</p><p className="text-xs text-faint">{formatDate(h.createdAt, true)} · {h.actor?.name ?? "System"}</p></div></li>))}
            </ol>
          </Section>
        </div>

        <div className="space-y-6">
          {canManage && (next.length || canCancel) ? (
            <Section title="Update order">
              <div className="space-y-4 p-5">
                {next.map((to) => (
                  <ActionForm key={to} action={orderStatusAction} className="space-y-3">
                    <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="to" value={to} />
                    {to === "SHIPPED" ? (
                      <div className="grid gap-2">
                        <input name="carrier" aria-label="Courier" placeholder="Courier (e.g. GIG Logistics)" className="input" />
                        <input name="trackingNumber" aria-label="Tracking number" placeholder="Tracking number" className="input" />
                        <input name="trackingUrl" aria-label="Tracking link" type="url" placeholder="Tracking link (optional)" className="input" />
                      </div>
                    ) : null}
                    <SubmitButton className="w-full" data-testid={`mark-${to}`}>Mark as {ORDER_STATUS_LABELS[to].toLowerCase()}</SubmitButton>
                  </ActionForm>
                ))}
                {canCancel ? (
                  <ActionForm action={orderStatusAction} className="space-y-2 border-t border-line pt-4">
                    <input type="hidden" name="orderId" value={o.id} /><input type="hidden" name="to" value="CANCELLED" />
                    <input name="note" aria-label="Reason" placeholder="Reason for cancelling" className="input" />
                    <SubmitButton className="btn-danger w-full" confirm="Cancel this unpaid order and release its stock?">Cancel order</SubmitButton>
                  </ActionForm>
                ) : null}
                <p className="text-xs text-faint">The customer is emailed at each step. Paid orders are cancelled through a refund.</p>
              </div>
            </Section>
          ) : null}
          <Section title="Customer">
            <div className="space-y-1 p-5 text-sm">
              <p className="font-medium">{o.customerName}</p>
              <p><a href={`mailto:${o.email}`} className="link">{o.email}</a></p>
              <p className="text-muted">{displayPhone(o.phone)}</p>
              {o.userId ? <p><Link href={`/admin/customers/${o.userId}`} className="link">View customer</Link></p> : <p className="text-xs text-faint">Guest checkout</p>}
            </div>
          </Section>
          <Section title="Delivery">
            <address className="p-5 text-sm leading-relaxed text-muted not-italic">
              {a.fullName}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{a.city}, {a.state}<br />{displayPhone(a.phone)}
              {o.notes ? <p className="mt-3 rounded-lg bg-card p-3 text-ink">Note: {o.notes}</p> : null}
              {o.shipments.map((s) => (<p key={s.id} className="mt-3">Shipped with {s.carrier ?? "courier"}{s.trackingNumber ? ` · ${s.trackingNumber}` : ""}</p>))}
            </address>
          </Section>
        </div>
      </div>
    </>
  );
}
