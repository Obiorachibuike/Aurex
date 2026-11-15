import { AlertTriangle, CheckCircle2, Clock, Lock, MapPin, PackageCheck, Truck, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelOrderAction, checkPaymentAction, requestRefundAction, retryPaymentAction } from "@/actions/checkout";
import { AutoRefresh } from "@/components/store/order-bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ProductImage, StatusBadge } from "@/components/ui/bits";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { getViewer } from "@/lib/viewer";
import { ORDER_STATUS_LABELS, getOrderForViewer } from "@/services/orders";
import { etaText } from "@/services/shipping";

export const metadata: Metadata = { title: "Order details", robots: { index: false, follow: false }, referrer: "no-referrer" };

const STEPS = [["PAID", "Payment confirmed"], ["PROCESSING", "Processing"], ["READY_FOR_DISPATCH", "Ready for dispatch"], ["SHIPPED", "Shipped"], ["DELIVERED", "Delivered"]] as const;

export default async function OrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string; payment?: string }> }) {
  const [{ number }, sp, { user }] = await Promise.all([params, searchParams, getViewer()]);
  const token = typeof sp.t === "string" ? sp.t : null;
  // Same 404 whether the order does not exist or simply is not yours.
  const order = await getOrderForViewer(decodeURIComponent(number), { user, accessToken: token });
  if (!order) notFound();

  const unpaid = order.status === "PENDING" || order.status === "AWAITING_PAYMENT";
  const paid = !!order.paidAt;
  const pendingPayment = order.payments.find((p) => p.status === "PENDING");
  const lastFailed = order.payments[0]?.status === "FAILED" || order.payments[0]?.status === "ABANDONED" ? order.payments[0] : null;
  const expired = unpaid && order.reservationExpiresAt && order.reservationExpiresAt < new Date();
  const stepIndex = STEPS.findIndex(([s]) => s === order.status);
  const shipment = order.shipments[0];
  const refund = order.refunds[0];
  const canRefund = paid && ["PAID", "PROCESSING", "READY_FOR_DISPATCH", "SHIPPED", "DELIVERED"].includes(order.status);
  const hidden = (
    <>
      <input type="hidden" name="number" value={order.number} />
      <input type="hidden" name="t" value={token ?? ""} />
    </>
  );

  return (
    <div className="container-x max-w-5xl py-8 sm:py-12">
      {unpaid && sp.payment === "pending" ? <AutoRefresh /> : null}

      {/* The banner reflects the stored, gateway-verified state — never the query string alone. */}
      {paid && order.status !== "REFUNDED" && order.status !== "CANCELLED" && sp.payment ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-success/40 bg-success/10 p-4" role="status" data-testid="payment-success">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div>
            <p className="font-semibold text-[#b5efd2]">Payment confirmed — thank you!</p>
            <p className="mt-0.5 text-sm text-muted">We&apos;ve verified your payment and emailed a confirmation to {order.email}. We&apos;ll update you as your order moves.</p>
          </div>
        </div>
      ) : null}
      {unpaid && sp.payment === "pending" ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4" role="status" data-testid="payment-pending">
          <Clock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-semibold text-[#f6d7a5]">We&apos;re confirming your payment</p>
            <p className="mt-0.5 text-sm text-muted">Your bank has not confirmed the payment yet. This page updates automatically — you don&apos;t need to pay again.</p>
          </div>
        </div>
      ) : null}
      {unpaid && (sp.payment === "failed" || (lastFailed && !pendingPayment)) ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4" role="alert" data-testid="payment-failed">
          <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div>
            <p className="font-semibold text-[#ffc9c3]">Payment was not completed</p>
            <p className="mt-0.5 text-sm text-muted">You have not been charged for this order. Your items are still reserved — you can try again below.</p>
          </div>
        </div>
      ) : null}
      {unpaid && sp.payment === "unavailable" ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p className="text-sm text-muted"><strong className="text-[#f6d7a5]">We couldn&apos;t reach the payment provider.</strong> Your order is saved and your items are reserved. Use “Pay now” to try again.</p>
        </div>
      ) : null}
      {sp.payment === "review" ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p className="text-sm text-muted"><strong className="text-[#f6d7a5]">Your payment needs a quick review by our team.</strong> We&apos;ve been notified and will contact you shortly. You will not lose any money.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-1.5">Order</p>
          <h1 className="font-mono text-2xl font-semibold sm:text-3xl" data-testid="order-number">{order.number}</h1>
          <p className="mt-1.5 text-sm text-muted">Placed {formatDate(order.createdAt, true)}{order.source === "AI" ? " · via AUREX Assistant" : ""}</p>
        </div>
        <StatusBadge status={order.status} className="px-3 py-1.5 text-sm" />
      </div>
      <p className="sr-only" data-testid="order-status">{order.status}</p>

      {unpaid ? (
        <section className="mt-6 rounded-xl border border-gold/40 bg-card p-5" aria-labelledby="pay-h">
          <h2 id="pay-h" className="flex items-center gap-2 text-lg font-semibold"><Lock className="size-4 text-gold" aria-hidden /> Complete your payment</h2>
          <p className="mt-1.5 text-sm text-muted">
            Amount due: <strong className="text-gold-bright tabular-nums">{formatMoney(order.total)}</strong>.{" "}
            {expired ? "The reservation window has passed — pay now if stock is still available." : order.reservationExpiresAt ? `Your items are reserved until ${formatDate(order.reservationExpiresAt, true)}.` : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <ActionForm action={retryPaymentAction}>{hidden}<SubmitButton data-testid="pay-now" pendingLabel="Opening secure payment…">Pay now</SubmitButton></ActionForm>
            {pendingPayment ? <ActionForm action={checkPaymentAction}>{hidden}<SubmitButton className="btn-outline" pendingLabel="Checking…">I&apos;ve already paid</SubmitButton></ActionForm> : null}
            <ActionForm action={cancelOrderAction}>{hidden}<SubmitButton className="btn-ghost" confirm="Cancel this order? Your reserved items will be released.">Cancel order</SubmitButton></ActionForm>
          </div>
        </section>
      ) : null}

      {stepIndex >= 0 ? (
        <section className="panel mt-6 p-5" aria-label="Order progress">
          <ol className="grid gap-4 sm:grid-cols-5">
            {STEPS.map(([key, label], i) => {
              const done = i <= stepIndex;
              return (
                <li key={key} className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2" aria-current={i === stepIndex ? "step" : undefined}>
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", done ? "border-gold bg-gold text-black" : "border-line text-faint")}>{done ? "✓" : i + 1}</span>
                  <span className={cn("text-sm", done ? "font-medium" : "text-faint")}>{label}</span>
                </li>
              );
            })}
          </ol>
          {shipment?.trackingNumber || shipment?.carrier ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm text-muted">
              <Truck className="size-4 text-gold" aria-hidden /> {shipment.carrier ?? "Courier"}{shipment.trackingNumber ? <> · Tracking <span className="font-mono text-ink">{shipment.trackingNumber}</span></> : null}
              {shipment.trackingUrl && /^https:\/\//.test(shipment.trackingUrl) ? <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="link">Track shipment</a> : null}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="panel" aria-labelledby="items-h">
          <h2 id="items-h" className="border-b border-line px-5 py-3.5 font-semibold">Items</h2>
          <ul className="divide-y divide-line px-5">
            {order.items.map((it) => (
              <li key={it.id} className="flex items-center gap-4 py-4 text-sm">
                <span className="relative size-14 shrink-0 overflow-hidden rounded-md bg-card"><ProductImage src={it.imageUrl} alt="" sizes="56px" /></span>
                <span className="min-w-0 flex-1">
                  {it.productSlug ? <Link href={`/products/${it.productSlug}`} className="line-clamp-2 font-medium hover:text-gold-bright">{it.productName}</Link> : <span className="font-medium">{it.productName}</span>}
                  <span className="block text-xs text-faint">SKU {it.sku}{it.qualityGrade ? ` · ${it.qualityGrade}` : ""}{it.warrantyMonths ? ` · ${it.warrantyMonths}-mo warranty` : ""}</span>
                  <span className="block text-xs text-muted">{it.quantity} × {formatMoney(it.unitPrice)}</span>
                </span>
                <span className="font-medium tabular-nums">{formatMoney(it.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-2 border-t border-line px-5 py-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums">{formatMoney(order.subtotal)}</dd></div>
            {order.discountTotal > 0 ? <div className="flex justify-between text-success"><dt>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</dt><dd className="tabular-nums">− {formatMoney(order.discountTotal)}</dd></div> : null}
            <div className="flex justify-between"><dt className="text-muted">Delivery · {order.shippingMethod.name}</dt><dd className="tabular-nums">{order.shippingTotal === 0 ? "Free" : formatMoney(order.shippingTotal)}</dd></div>
            {order.taxTotal > 0 ? <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd className="tabular-nums">{formatMoney(order.taxTotal)}</dd></div> : null}
            <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd className="text-gold-bright tabular-nums" data-testid="order-total">{formatMoney(order.total)}</dd></div>
          </dl>
        </section>

        <div className="space-y-6">
          <section className="panel p-5" aria-labelledby="del-h">
            <h2 id="del-h" className="flex items-center gap-2 font-semibold"><MapPin className="size-4 text-gold" aria-hidden /> Delivery</h2>
            <address className="mt-3 text-sm leading-relaxed text-muted not-italic">
              <span className="text-ink">{order.shippingAddress.fullName}</span><br />
              {order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}<br />
              {order.shippingAddress.city}, {order.shippingAddress.state}<br />
              {order.shippingAddress.phone}
            </address>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted"><PackageCheck className="size-4 text-gold" aria-hidden /> {order.shippingMethod.name} · {etaText(order.shippingMethod.etaMinDays, order.shippingMethod.etaMaxDays)}</p>
          </section>

          <section className="panel p-5" aria-labelledby="payh">
            <h2 id="payh" className="font-semibold">Payment</h2>
            <p className="mt-2 text-sm text-muted" data-testid="payment-state">
              {order.status === "REFUNDED" ? "Refunded" : paid ? `Verified ${formatDate(order.paidAt, true)}` : order.status === "CANCELLED" ? "Not paid — order cancelled" : "Not yet paid"}
            </p>
            {order.payments.length ? (
              <ul className="mt-3 space-y-2 text-xs">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-faint">{p.reference}</span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {refund ? (
            <section className="panel p-5">
              <h2 className="font-semibold">Refund</h2>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted"><StatusBadge status={refund.status} /> {formatMoney(refund.amount)}</p>
              {refund.adminNote ? <p className="mt-2 text-sm text-muted">{refund.adminNote}</p> : null}
            </section>
          ) : canRefund ? (
            <details className="panel p-5">
              <summary className="cursor-pointer text-sm font-medium">Request a refund</summary>
              <ActionForm action={requestRefundAction} className="mt-4 space-y-3">
                {hidden}
                <label htmlFor="reason" className="label">Reason</label>
                <textarea id="reason" name="reason" required minLength={10} maxLength={1000} className="input" placeholder="Tell us what went wrong" />
                <SubmitButton className="btn-outline w-full">Submit request</SubmitButton>
                <p className="hint">See our <Link href="/policies/returns" className="link">returns & refund policy</Link>.</p>
              </ActionForm>
            </details>
          ) : null}
        </div>
      </div>

      <section className="panel mt-6 p-5" aria-labelledby="hist-h">
        <h2 id="hist-h" className="font-semibold">Order history</h2>
        <ol className="mt-4 space-y-3 text-sm">
          {order.history.map((h) => (
            <li key={h.id} className="flex gap-3">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" aria-hidden />
              <span>
                <span className="font-medium">{ORDER_STATUS_LABELS[h.toStatus]}</span>
                <span className="text-faint"> · {formatDate(h.createdAt, true)}</span>
                {h.note ? <span className="block text-muted">{h.note}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-8 text-center text-sm text-muted">Need help with this order? <Link href="/contact" className="link">Contact support</Link></p>
    </div>
  );
}
