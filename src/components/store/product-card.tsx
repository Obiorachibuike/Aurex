import { Check, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Price, ProductImage, Stars } from "@/components/ui/bits";
import type { ProductCardView } from "@/services/catalog";
import { AddToCartButton } from "./cart-buttons";

export function ProductCard({ product, priority, fitsDevice }: { product: ProductCardView; priority?: boolean; fitsDevice?: string | null }) {
  const href = `/products/${product.slug}`;
  const single = product.variants.length === 1;
  const variant = product.variants.find((v) => v.id === product.defaultVariantId) ?? product.variants[0];
  const onSale = !!product.compareAtPrice && product.compareAtPrice > product.price;
  const fits = product.isUniversal ? "Universal fit" : product.compatibleDevices.length === 1 ? product.compatibleDevices[0]!.label : product.compatibleDevices.length > 1 ? `${product.compatibleDevices[0]!.label} +${product.compatibleDevices.length - 1} more` : null;
  return (
    <article data-testid="product-card" className="group card relative flex flex-col overflow-hidden transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-gold/50">
      <Link href={href} className="relative block aspect-square overflow-hidden bg-surface" tabIndex={-1} aria-hidden>
        <ProductImage src={product.imageUrl} alt="" priority={priority} className="transition-transform duration-500 group-hover:scale-[1.04]" />
        <span className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5">
          {onSale ? <span className="badge badge-gold bg-black/70 backdrop-blur">Save {Math.round((1 - product.price / product.compareAtPrice!) * 100)}%</span> : null}
          {!product.inStock ? <span className="badge bg-black/70 backdrop-blur">Out of stock</span> : null}
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3.5 sm:p-4">
        <p className="text-[0.68rem] tracking-[0.14em] text-faint uppercase">
          {product.category.name}
          {product.qualityGrade ? <span className="text-gold"> · {product.qualityGrade}</span> : null}
        </p>
        <h3 className="line-clamp-2 text-sm leading-snug font-medium sm:text-[0.95rem]">
          <Link href={href} className="after:absolute after:inset-0 hover:text-gold-bright">
            {product.name}
          </Link>
        </h3>
        {fitsDevice ? (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <Check className="size-3.5" aria-hidden /> Fits {fitsDevice}
          </p>
        ) : fits ? (
          <p className="truncate text-xs text-muted">Fits: {fits}</p>
        ) : null}
        <div className="flex items-center gap-3 text-xs text-faint">
          {product.ratingCount > 0 ? <Stars value={product.ratingAvg} count={product.ratingCount} /> : null}
          {product.warrantyMonths > 0 ? (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5 text-gold" aria-hidden /> {product.warrantyMonths}-mo warranty
            </span>
          ) : null}
        </div>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
          <div>
            {product.hasMultiplePrices ? <span className="block text-[0.65rem] text-faint">From</span> : null}
            <Price amount={product.price} compareAt={product.compareAtPrice} />
            {variant?.wholesale ? <span className="block text-[0.7rem] text-muted">Wholesale from {variant.wholesale.minQuantity}+ units</span> : null}
          </div>
          <div className="relative z-10">
            {single ? (
              <AddToCartButton variantId={variant?.inStock ? variant.id : null} compact label="Add" />
            ) : (
              <Link href={href} className="btn btn-outline btn-sm">
                Options
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, fitsDevice, priorityCount = 0 }: { products: ProductCardView[]; fitsDevice?: string | null; priorityCount?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} priority={i < priorityCount} fitsDevice={fitsDevice} />
      ))}
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="skeleton aspect-square rounded-none" />
          <div className="space-y-2.5 p-4">
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton mt-3 h-8 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
