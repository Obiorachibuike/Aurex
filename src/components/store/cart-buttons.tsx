"use client";

import { Check, Heart, Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleWishlistAction } from "@/actions/account";
import { addToCartAction, applyCouponAction, removeItemAction, setQuantityAction } from "@/actions/cart";
import { cn } from "@/lib/utils";

export function AddToCartButton({ variantId, quantity = 1, disabled, className, label = "Add to cart", compact }: { variantId: string | null; quantity?: number; disabled?: boolean; className?: string; label?: string; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();
  if (!variantId || disabled) {
    return (
      <button type="button" disabled className={cn("btn btn-outline", compact && "btn-sm", className)}>
        Out of stock
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="add-to-cart"
      className={cn("btn btn-gold", compact && "btn-sm", className)}
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        start(async () => {
          const res = await addToCartAction(variantId, quantity);
          if (res?.ok) {
            setDone(true);
            setTimeout(() => setDone(false), 1800);
            toast.success(res.message ?? "Added to cart", { action: { label: "View cart", onClick: () => router.push("/cart") } });
          } else toast.error(res?.error ?? "Could not add to cart");
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : done ? <Check className="size-4" aria-hidden /> : <ShoppingBag className="size-4" aria-hidden />}
      {done ? "Added" : label}
    </button>
  );
}

export function WishlistButton({ productId, saved: initial, signedIn, className }: { productId: string; saved: boolean; signedIn: boolean; className?: string }) {
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      disabled={pending}
      className={cn("btn btn-outline btn-icon", saved && "border-gold/60 text-gold-bright", className)}
      onClick={() => {
        if (!signedIn) {
          router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        start(async () => {
          const res = await toggleWishlistAction(productId);
          if (res?.ok) {
            setSaved(!!res.data?.saved);
            toast.success(res.message ?? "Updated");
          } else toast.error(res?.error ?? "Could not update wishlist");
        });
      }}
    >
      <Heart className={cn("size-5", saved && "fill-gold")} aria-hidden />
    </button>
  );
}

export function QuantityStepper({ value, onChange, min = 1, max = 9999, disabled, label = "Quantity" }: { value: number; onChange: (n: number) => void; min?: number; max?: number; disabled?: boolean; label?: string }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? Math.round(n) : min));
  return (
    <div className="inline-flex h-11 items-stretch overflow-hidden rounded-lg border border-line bg-surface" role="group" aria-label={label}>
      <button type="button" className="flex w-10 items-center justify-center text-muted hover:bg-raised hover:text-ink disabled:opacity-40" onClick={() => onChange(clamp(value - 1))} disabled={disabled || value <= min} aria-label="Decrease quantity">
        <Minus className="size-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label={label}
        data-testid="quantity-input"
        className="w-14 [appearance:textfield] border-x border-line bg-transparent text-center text-sm font-medium tabular-nums outline-none focus:bg-raised [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" className="flex w-10 items-center justify-center text-muted hover:bg-raised hover:text-ink disabled:opacity-40" onClick={() => onChange(clamp(value + 1))} disabled={disabled || value >= max} aria-label="Increase quantity">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export function CartLineControls({ variantId, quantity, max }: { variantId: string; quantity: number; max: number }) {
  const [pending, start] = useTransition();
  const [qty, setQty] = useState(quantity);
  const update = (n: number) => {
    setQty(n);
    start(async () => {
      const res = await setQuantityAction(variantId, n);
      if (!res?.ok) {
        setQty(quantity);
        toast.error(res?.error ?? "Could not update quantity");
      }
    });
  };
  return (
    <div className="flex items-center gap-2">
      <QuantityStepper value={qty} onChange={update} max={Math.max(1, max)} disabled={pending} />
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Remove item"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await removeItemAction(variantId);
            if (res?.ok) toast.success("Item removed");
            else toast.error(res?.error ?? "Could not remove item");
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </button>
    </div>
  );
}

export function CouponBox({ applied }: { applied: string | null }) {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 text-sm">
        <span>
          Coupon <strong className="text-gold-bright">{applied}</strong> applied
        </span>
        <button type="button" className="link text-xs" disabled={pending} onClick={() => start(async () => void (await applyCouponAction(null)))}>
          Remove
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!code.trim()) return;
        setError(null);
        start(async () => {
          const res = await applyCouponAction(code);
          if (res?.ok) {
            toast.success(res.message ?? "Coupon applied");
            setCode("");
          } else setError(res?.error ?? "That coupon could not be applied.");
        });
      }}
    >
      <label htmlFor="coupon" className="label">
        Coupon code
      </label>
      <div className="flex gap-2">
        <input id="coupon" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="input uppercase" placeholder="e.g. WELCOME10" autoComplete="off" aria-invalid={!!error} aria-describedby={error ? "coupon-error" : undefined} />
        <button type="submit" className="btn btn-outline shrink-0" disabled={pending || !code.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Apply"}
        </button>
      </div>
      {error ? (
        <p id="coupon-error" role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ContinueShopping() {
  return (
    <Link href="/products" className="btn btn-outline">
      Continue shopping
    </Link>
  );
}
