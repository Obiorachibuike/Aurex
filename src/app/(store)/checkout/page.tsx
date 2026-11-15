import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutForm } from "@/components/store/checkout-form";
import { ProductImage } from "@/components/ui/bits";
import { formatMoney } from "@/lib/utils";
import { getCurrentCart, getViewer } from "@/lib/viewer";
import { listAddresses } from "@/services/account";
import { getAvailableProviders } from "@/services/payments";
import { getSetting } from "@/services/settings";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const { user } = await getViewer();
  const cart = await getCurrentCart();
  if (!cart.lines.length || cart.hasIssues) redirect("/cart");
  const [addresses, providers, tax] = await Promise.all([user ? listAddresses(user.id) : Promise.resolve([]), getAvailableProviders(), getSetting("tax")]);
  return (
    <div className="container-x py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">Checkout</h1>
        {!user ? (
          <p className="text-sm text-muted">
            Have an account? <Link href="/login?next=/checkout" className="link">Sign in</Link> for saved addresses — or continue as a guest.
          </p>
        ) : null}
      </div>
      <details className="panel mt-6 group" open>
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>Items in this order ({cart.itemCount})</span>
          <span className="text-gold-bright tabular-nums">{formatMoney(cart.totals.subtotal)}</span>
        </summary>
        <ul className="divide-y divide-line border-t border-line px-5">
          {cart.lines.map((l) => (
            <li key={l.variantId} className="flex items-center gap-3.5 py-3 text-sm">
              <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-card"><ProductImage src={l.imageUrl} alt="" sizes="48px" /></span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1">{l.name}</span>
                <span className="text-xs text-faint">{l.quantity} × {formatMoney(l.unitPrice)}</span>
              </span>
              <span className="tabular-nums">{formatMoney(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </details>
      <div className="mt-6">
        <CheckoutForm
          user={user ? { name: user.name, email: user.email, phone: user.phone } : null}
          addresses={addresses.map((a) => ({ id: a.id, label: a.label, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, state: a.state, isDefault: a.isDefault }))}
          providers={providers}
          summary={{ subtotal: cart.totals.subtotal, discount: cart.totals.discountTotal, itemCount: cart.itemCount, freeShipping: !!cart.coupon?.valid && cart.coupon.freeShipping, taxLabel: tax.label, taxRate: tax.ratePercent, pricesIncludeTax: tax.pricesIncludeTax }}
        />
      </div>
    </div>
  );
}
