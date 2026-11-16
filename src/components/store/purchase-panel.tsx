"use client";

import { Check, PackageX, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import { Price } from "@/components/ui/bits";
import { cn, formatMoney } from "@/lib/utils";
import type { VariantView } from "@/services/catalog";
import { AddToCartButton, QuantityStepper, WishlistButton } from "./cart-buttons";

/** Unit price for a quantity — mirrors the server rule for display only; the server always recomputes. */
function unitPriceFor(v: VariantView, qty: number): number {
  if (!v.wholesale) return v.price;
  let price = v.price;
  if (qty >= v.wholesale.minQuantity) price = Math.min(price, v.wholesale.price);
  for (const b of v.wholesale.breaks) if (qty >= b.minQuantity) price = Math.min(price, b.unitPrice);
  return price;
}

export function PurchasePanel({ productId, variants, defaultVariantId, saved, signedIn }: { productId: string; variants: VariantView[]; defaultVariantId: string | null; saved: boolean; signedIn: boolean }) {
  const initial = variants.find((v) => v.id === defaultVariantId && v.inStock) ?? variants.find((v) => v.inStock) ?? variants[0];
  const [variantId, setVariantId] = useState(initial?.id ?? null);
  const [qty, setQty] = useState(1);
  const variant = variants.find((v) => v.id === variantId) ?? initial;
  const tiers = useMemo(() => {
    if (!variant?.wholesale) return [];
    const rows = [{ minQuantity: variant.wholesale.minQuantity, unitPrice: variant.wholesale.price }, ...variant.wholesale.breaks];
    const best = new Map<number, number>();
    for (const r of rows) best.set(r.minQuantity, Math.min(best.get(r.minQuantity) ?? Infinity, r.unitPrice));
    let floor = Infinity;
    return [...best.entries()].sort((a, b) => a[0] - b[0]).filter(([, p]) => (p < floor ? ((floor = p), true) : false)).map(([minQuantity, unitPrice]) => ({ minQuantity, unitPrice }));
  }, [variant]);

  if (!variant) return <p className="panel p-4 text-sm text-muted">This product is currently unavailable.</p>;
  const unit = unitPriceFor(variant, qty);
  const low = variant.inStock && variant.available <= 5;

  return (
    <div className="space-y-5">
      <div>
        <Price amount={unit} compareAt={variant.compareAtPrice} size="lg" />
        {variant.wholesale ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted" data-testid="wholesale-note">
            <Tag className="size-3.5 text-gold" aria-hidden />
            {unit < variant.price ? (
              <span>
                Wholesale price applied · retail <span className="line-through">{formatMoney(variant.price)}</span>
              </span>
            ) : (
              <span>
                Wholesale {formatMoney(variant.wholesale.price)} from {variant.wholesale.minQuantity} units
              </span>
            )}
          </p>
        ) : null}
      </div>

      {variants.length > 1 ? (
        <fieldset>
          <legend className="label">Option</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <label key={v.id} className={cn("cursor-pointer rounded-lg border px-3.5 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold-bright", v.id === variant.id ? "border-gold bg-gold/10 text-gold-bright" : "border-line hover:border-[#444]", !v.inStock && "opacity-55")}>
                <input type="radio" name="variant" value={v.id} checked={v.id === variant.id} onChange={() => { setVariantId(v.id); setQty(1); }} className="sr-only" />
                <span className="block font-medium">{v.name}</span>
                <span className="block text-xs text-muted">{v.inStock ? formatMoney(v.price) : "Out of stock"}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <p className={cn("flex items-center gap-2 text-sm", variant.inStock ? (low ? "text-warning" : "text-success") : "text-danger")} data-testid="stock-status" role="status">
        {variant.inStock ? <Check className="size-4" aria-hidden /> : <PackageX className="size-4" aria-hidden />}
        {variant.inStock ? (low ? `Only ${variant.available} left in stock` : `In stock · ${variant.available} available`) : "Out of stock"}
        <span className="text-faint">· SKU {variant.sku}</span>
      </p>

      {tiers.length ? (
        <div className="panel overflow-hidden" data-testid="wholesale-tiers">
          <p className="border-b border-line px-4 py-2.5 text-xs font-medium tracking-wide text-gold uppercase">Your wholesale pricing</p>
          <table className="w-full text-sm">
            <tbody>
              {tiers.map((t) => (
                <tr key={t.minQuantity} className={cn("border-b border-line/60 last:border-0", qty >= t.minQuantity && unit === t.unitPrice && "bg-gold/10")}>
                  <td className="px-4 py-2 text-muted">{t.minQuantity}+ units</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(t.unitPrice)} each</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper value={qty} onChange={setQty} max={Math.max(1, variant.available)} disabled={!variant.inStock} />
        <AddToCartButton variantId={variant.inStock ? variant.id : null} quantity={qty} className="btn-lg min-w-44 flex-1" />
        <WishlistButton productId={productId} saved={saved} signedIn={signedIn} className="size-[3.1rem]" />
      </div>
      {variant.inStock && qty > 1 ? (
        <p className="text-sm text-muted">
          Subtotal: <strong className="text-ink tabular-nums">{formatMoney(unit * qty)}</strong>
        </p>
      ) : null}
    </div>
  );
}

export function Gallery({ images, name }: { images: { url: string; alt: string | null }[]; name: string }) {
  const [active, setActive] = useState(0);
  const current = images[active] ?? images[0];
  return (
    <div>
      <div className="card relative aspect-square overflow-hidden bg-surface">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element -- the gallery swaps sources client-side; the first image is preloaded by the page
          <img src={current.url} alt={current.alt ?? name} className="absolute inset-0 size-full object-cover" fetchPriority="high" />
        ) : (
          <div className="flex size-full items-center justify-center text-xs tracking-[0.3em] text-faint">AUREX</div>
        )}
      </div>
      {images.length > 1 ? (
        <ul className="mt-3 flex gap-2.5 overflow-x-auto pb-1" aria-label="Product images">
          {images.map((im, i) => (
            <li key={im.url + i}>
              <button type="button" onClick={() => setActive(i)} aria-label={`Show image ${i + 1} of ${images.length}`} aria-current={i === active} className={cn("relative block size-[4.5rem] overflow-hidden rounded-lg border bg-surface transition-colors", i === active ? "border-gold" : "border-line hover:border-[#444]")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.url} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
