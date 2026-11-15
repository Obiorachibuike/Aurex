"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, MapPin, Truck } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { placeOrderAction, shippingOptionsAction } from "@/actions/checkout";
import { NIGERIAN_STATES } from "@/lib/nigeria";
import { cn, formatMoney } from "@/lib/utils";
import { checkoutSchema, type CheckoutInput } from "@/lib/validation";
import type { ShippingOption } from "@/services/shipping";

type SavedAddress = { id: string; label: string | null; fullName: string; phone: string; line1: string; line2: string | null; city: string; state: string; isDefault: boolean };
type Props = {
  user: { name: string; email: string; phone: string | null } | null;
  addresses: SavedAddress[];
  providers: { provider: "PAYSTACK" | "FLUTTERWAVE"; label: string; isDefault: boolean }[];
  summary: { subtotal: number; discount: number; itemCount: number; freeShipping: boolean; taxLabel: string; taxRate: number; pricesIncludeTax: boolean };
};

export function CheckoutForm({ user, addresses, providers, summary }: Props) {
  const first = addresses.find((a) => a.isDefault) ?? addresses[0];
  const [options, setOptions] = useState<ShippingOption[] | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [addressId, setAddressId] = useState(first?.id ?? "new");
  const requestId = useRef(0);

  const { register, handleSubmit, watch, setValue, reset, getValues, formState: { errors } } = useForm<CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    mode: "onBlur",
    defaultValues: {
      fullName: first?.fullName ?? user?.name ?? "", email: user?.email ?? "", phone: first?.phone ?? user?.phone ?? "", line1: first?.line1 ?? "", line2: first?.line2 ?? "", city: first?.city ?? "",
      state: (first?.state ?? "") as CheckoutInput["state"], shippingMethodId: "", provider: providers.find((p) => p.isDefault)?.provider ?? providers[0]?.provider, notes: "", saveAddress: !first,
    },
  });
  const state = watch("state");
  const methodId = watch("shippingMethodId");

  useEffect(() => {
    if (!state) return;
    const id = ++requestId.current;
    setLoadingOptions(true);
    setOptionsError(null);
    shippingOptionsAction(state).then((res) => {
      if (id !== requestId.current) return; // a newer state was chosen meanwhile
      setLoadingOptions(false);
      if (res?.ok && res.data) {
        setOptions(res.data.options);
        const keep = res.data.options.find((o) => o.id === getValues("shippingMethodId"));
        setValue("shippingMethodId", keep?.id ?? res.data.options[0]?.id ?? "", { shouldValidate: !!res.data.options.length });
        if (!res.data.options.length) setOptionsError("We don't deliver to this state yet. Please contact us and we'll arrange it.");
      } else {
        setOptions([]);
        setOptionsError(res?.error ?? "Could not load delivery options.");
      }
    });
  }, [state, setValue, getValues]);

  const chooseAddress = (id: string) => {
    setAddressId(id);
    const a = addresses.find((x) => x.id === id);
    const keep = { email: getValues("email"), provider: getValues("provider"), notes: getValues("notes") };
    if (a) reset({ ...keep, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state as CheckoutInput["state"], shippingMethodId: "", saveAddress: false });
    else reset({ ...keep, fullName: user?.name ?? "", phone: user?.phone ?? "", line1: "", line2: "", city: "", state: "" as CheckoutInput["state"], shippingMethodId: "", saveAddress: true });
    if (!a) setOptions(null);
  };

  const selected = options?.find((o) => o.id === methodId);
  const taxable = summary.subtotal - summary.discount;
  const tax = summary.taxRate > 0 && !summary.pricesIncludeTax ? Math.round((taxable * summary.taxRate) / 100) : 0;
  const total = taxable + (selected?.fee ?? 0) + tax;

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    start(async () => {
      const res = await placeOrderAction(values);
      if (res?.ok && res.data) window.location.assign(res.data.redirectTo);
      else {
        setServerError(res?.error ?? "We could not place your order. Please try again.");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  });

  const err = (name: keyof CheckoutInput) => (errors[name] ? <p className="field-error" id={`${name}-error`} role="alert">{errors[name]?.message as string}</p> : null);
  const field = (name: keyof CheckoutInput) => ({ id: name, "aria-invalid": !!errors[name], "aria-describedby": errors[name] ? `${name}-error` : undefined, className: "input", ...register(name) });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[1fr_22rem]" data-testid="checkout-form">
      <div className="space-y-6">
        {serverError ? <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-[#ffc9c3]" data-testid="checkout-error">{serverError}</p> : null}

        <section className="panel p-5" aria-labelledby="co-contact">
          <h2 id="co-contact" className="text-lg font-semibold">1. Contact</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fullName" className="label">Full name</label>
              <input {...field("fullName")} autoComplete="name" />
              {err("fullName")}
            </div>
            <div>
              <label htmlFor="phone" className="label">Phone number</label>
              <input {...field("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" />
              {err("phone") ?? <p className="hint">The rider will call this number.</p>}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="email" className="label">Email for order updates</label>
              <input {...field("email")} type="email" autoComplete="email" readOnly={!!user} className={cn("input", user && "opacity-70")} />
              {err("email")}
            </div>
          </div>
        </section>

        <section className="panel p-5" aria-labelledby="co-address">
          <h2 id="co-address" className="flex items-center gap-2 text-lg font-semibold"><MapPin className="size-4 text-gold" aria-hidden /> 2. Delivery address</h2>
          {addresses.length ? (
            <div className="mt-4">
              <label htmlFor="saved" className="label">Saved addresses</label>
              <select id="saved" className="input" value={addressId} onChange={(e) => chooseAddress(e.target.value)}>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>{a.label ? `${a.label} — ` : ""}{a.line1}, {a.city}, {a.state}</option>
                ))}
                <option value="new">Use a new address</option>
              </select>
            </div>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="line1" className="label">Street address</label>
              <input {...field("line1")} autoComplete="address-line1" placeholder="House number and street" />
              {err("line1")}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="line2" className="label">Landmark / additional directions (optional)</label>
              <input {...field("line2")} autoComplete="address-line2" />
            </div>
            <div>
              <label htmlFor="city" className="label">City / town</label>
              <input {...field("city")} autoComplete="address-level2" />
              {err("city")}
            </div>
            <div>
              <label htmlFor="state" className="label">State</label>
              <select {...field("state")} autoComplete="address-level1">
                <option value="">Select state</option>
                {NIGERIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {err("state")}
            </div>
          </div>
          {user && addressId === "new" ? (
            <label className="mt-4 flex items-center gap-2.5 text-sm text-muted">
              <input type="checkbox" className="check" {...register("saveAddress")} /> Save this address to my account
            </label>
          ) : null}
        </section>

        <section className="panel p-5" aria-labelledby="co-delivery">
          <h2 id="co-delivery" className="flex items-center gap-2 text-lg font-semibold"><Truck className="size-4 text-gold" aria-hidden /> 3. Delivery method</h2>
          <div className="mt-4" aria-live="polite">
            {!state ? (
              <p className="text-sm text-muted">Select your state to see delivery options and fees.</p>
            ) : loadingOptions ? (
              <div className="space-y-2.5" aria-label="Loading delivery options"><div className="skeleton h-16" /><div className="skeleton h-16" /></div>
            ) : options?.length ? (
              <fieldset className="space-y-2.5">
                <legend className="sr-only">Delivery method</legend>
                {options.map((o) => (
                  <label key={o.id} data-testid="shipping-option" className={cn("flex cursor-pointer items-center gap-3.5 rounded-xl border p-3.5 transition-colors", methodId === o.id ? "border-gold bg-gold/10" : "border-line hover:border-[#444]")}>
                    <input type="radio" value={o.id} className="check" {...register("shippingMethodId")} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{o.name}</span>
                      <span className="block text-xs text-muted">{o.etaText}{o.description ? ` · ${o.description}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{o.fee === 0 ? "Free" : formatMoney(o.fee)}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {optionsError ? <p className="field-error" role="alert">{optionsError}</p> : null}
            {err("shippingMethodId")}
          </div>
        </section>

        <section className="panel p-5" aria-labelledby="co-pay">
          <h2 id="co-pay" className="flex items-center gap-2 text-lg font-semibold"><Lock className="size-4 text-gold" aria-hidden /> 4. Payment</h2>
          {providers.length ? (
            <fieldset className="mt-4 space-y-2.5">
              <legend className="sr-only">Payment method</legend>
              {providers.map((p) => (
                <label key={p.provider} className={cn("flex cursor-pointer items-center gap-3.5 rounded-xl border p-3.5", watch("provider") === p.provider ? "border-gold bg-gold/10" : "border-line")}>
                  <input type="radio" value={p.provider} className="check" {...register("provider")} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Pay with {p.label}</span>
                    <span className="block text-xs text-muted">Card, bank transfer or USSD on {p.label}&apos;s secure page</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm text-[#f6d7a5]" role="alert">Online payment is not available right now. Please contact support to complete your order.</p>
          )}
          <p className="mt-3 text-xs text-faint">We never see or store your card details. Your order is confirmed once the payment provider verifies your payment.</p>
          <div className="mt-4">
            <label htmlFor="notes" className="label">Order notes (optional)</label>
            <textarea {...field("notes")} rows={2} maxLength={500} placeholder="Anything the rider or our team should know" />
          </div>
        </section>
      </div>

      <aside className="panel h-fit p-5 lg:sticky lg:top-36" aria-label="Order total">
        <h2 className="text-lg font-semibold">Order total</h2>
        <dl className="mt-4 space-y-2.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Subtotal ({summary.itemCount} item{summary.itemCount === 1 ? "" : "s"})</dt><dd className="tabular-nums">{formatMoney(summary.subtotal)}</dd></div>
          {summary.discount > 0 ? <div className="flex justify-between text-success"><dt>Discount</dt><dd className="tabular-nums">− {formatMoney(summary.discount)}</dd></div> : null}
          <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="tabular-nums" data-testid="shipping-fee">{selected ? (selected.fee === 0 ? "Free" : formatMoney(selected.fee)) : "—"}</dd></div>
          {tax > 0 ? <div className="flex justify-between"><dt className="text-muted">{summary.taxLabel} ({summary.taxRate}%)</dt><dd className="tabular-nums">{formatMoney(tax)}</dd></div> : null}
          <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd className="text-gold-bright tabular-nums" data-testid="checkout-total">{selected ? formatMoney(total) : "—"}</dd></div>
        </dl>
        {summary.taxRate > 0 && summary.pricesIncludeTax ? <p className="mt-2 text-xs text-faint">Prices include {summary.taxLabel}.</p> : null}
        <button type="submit" className="btn btn-gold btn-lg mt-5 w-full" disabled={pending || !providers.length} data-testid="place-order">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
          {pending ? "Placing your order…" : selected ? `Pay ${formatMoney(total)}` : "Continue to payment"}
        </button>
        <p className="mt-3 text-center text-xs text-faint">The final amount is confirmed by our server before you pay.</p>
      </aside>
    </form>
  );
}
