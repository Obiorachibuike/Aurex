import { AlertTriangle, Lock, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CartLineControls, CouponBox } from "@/components/store/cart-buttons";
import { EmptyState, ProductImage } from "@/components/ui/bits";
import { formatMoney } from "@/lib/utils";
import { getCurrentCart } from "@/lib/viewer";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage() {
  const cart = await getCurrentCart();
  if (!cart.lines.length) {
    return (
      <div className="container-x py-12">
        <h1 className="mb-6 text-3xl font-semibold">Your cart</h1>
        <EmptyState icon={<ShoppingBag className="size-5" />} title="Your cart is empty" action={<Link href="/products" className="btn btn-gold">Shop parts</Link>}>
          Find the right part for your phone by model, or ask the AUREX assistant to help.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="container-x py-8 sm:py-12">
      <h1 className="text-3xl font-semibold">Your cart</h1>
      <p className="mt-1.5 text-sm text-muted">
        {cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}
        {cart.tier === "WHOLESALE" ? <span className="badge badge-gold ml-2">Wholesale pricing active</span> : null}
      </p>
      <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_22rem]">
        <ul className="space-y-3" data-testid="cart-lines">
          {cart.lines.map((l) => (
            <li key={l.variantId} className="card flex gap-4 p-3.5 sm:p-4" data-testid="cart-line">
              <Link href={`/products/${l.slug}`} className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-surface sm:size-24" tabIndex={-1} aria-hidden>
                <ProductImage src={l.imageUrl} alt="" sizes="96px" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/products/${l.slug}`} className="line-clamp-2 text-sm font-medium hover:text-gold-bright sm:text-base">{l.name}</Link>
                    <p className="mt-0.5 text-xs text-faint">
                      {l.variantName !== "Standard" ? `${l.variantName} · ` : ""}SKU {l.sku}
                      {l.qualityGrade ? ` · ${l.qualityGrade}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-right font-semibold tabular-nums" data-testid="line-total">{formatMoney(l.lineTotal)}</p>
                </div>
                <p className="text-xs text-muted">
                  {formatMoney(l.unitPrice)} each
                  {l.unitPrice < l.listPrice ? <span className="ml-1.5 text-gold">wholesale · retail {formatMoney(l.listPrice)}</span> : null}
                </p>
                {l.issue ? (
                  <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
                    <AlertTriangle className="size-3.5" aria-hidden /> {l.issue}
                  </p>
                ) : null}
                <div className="mt-auto">
                  <CartLineControls key={`${l.variantId}:${l.quantity}`} variantId={l.variantId} quantity={l.quantity} max={l.available} />
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="panel h-fit p-5 lg:sticky lg:top-36" aria-label="Order summary">
          <h2 className="text-lg font-semibold">Summary</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular-nums" data-testid="cart-subtotal">{formatMoney(cart.totals.subtotal)}</dd></div>
            {cart.totals.discountTotal > 0 ? (
              <div className="flex justify-between text-success"><dt>Discount</dt><dd className="tabular-nums">− {formatMoney(cart.totals.discountTotal)}</dd></div>
            ) : null}
            <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="text-muted">{cart.coupon?.valid && cart.coupon.freeShipping ? "Free with coupon" : "Calculated at checkout"}</dd></div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd className="text-gold-bright tabular-nums">{formatMoney(cart.totals.subtotal - cart.totals.discountTotal)}</dd></div>
          </dl>
          <div className="mt-5">
            <CouponBox applied={cart.coupon?.valid ? cart.coupon.code : null} />
            {cart.coupon && !cart.coupon.valid ? <p className="field-error">{cart.coupon.message}</p> : null}
          </div>
          {cart.hasIssues ? (
            <p className="mt-5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-[#ffc9c3]" role="alert">Please fix the highlighted items before checking out.</p>
          ) : (
            <Link href="/checkout" className="btn btn-gold btn-lg mt-5 w-full" data-testid="checkout-link">
              <Lock className="size-4" aria-hidden /> Proceed to checkout
            </Link>
          )}
          <Link href="/products" className="btn btn-ghost mt-2 w-full">Continue shopping</Link>
        </aside>
      </div>
    </div>
  );
}
