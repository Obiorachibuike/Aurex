import type { Metadata } from "next";
import { saveMethodAction, saveZoneAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requireStaffPage } from "@/lib/auth/session";
import { NIGERIAN_STATES } from "@/lib/nigeria";
import { formatMoney } from "@/lib/utils";
import { listShipping } from "@/services/admin-catalog";

export const metadata: Metadata = { title: "Delivery" };
type Zone = Awaited<ReturnType<typeof listShipping>>[number];
type Method = Zone["methods"][number];

function MethodFields({ zoneId, m }: { zoneId: string; m?: Method }) {
  const k = m?.id ?? `new-${zoneId}`;
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <input type="hidden" name="zoneId" value={zoneId} />{m ? <input type="hidden" name="id" value={m.id} /> : null}
      <div className="lg:col-span-2"><label className="label" htmlFor={`mn-${k}`}>Method name</label><input id={`mn-${k}`} name="name" required defaultValue={m?.name} placeholder="Standard delivery" className="input" /></div>
      <div><label className="label" htmlFor={`mb-${k}`}>Base fee (₦)</label><input id={`mb-${k}`} name="baseFee" required inputMode="decimal" defaultValue={m ? m.baseFee / 100 : ""} className="input" /></div>
      <div><label className="label" htmlFor={`mp-${k}`}>Per extra item (₦)</label><input id={`mp-${k}`} name="perItemFee" inputMode="decimal" defaultValue={m ? m.perItemFee / 100 : ""} className="input" /></div>
      <div><label className="label" htmlFor={`mf-${k}`}>Free above (₦)</label><input id={`mf-${k}`} name="freeAbove" inputMode="decimal" defaultValue={m?.freeAbove ? m.freeAbove / 100 : ""} className="input" /></div>
      <div className="flex gap-2"><div><label className="label" htmlFor={`m1-${k}`}>Days min</label><input id={`m1-${k}`} name="etaMinDays" type="number" min={0} required defaultValue={m?.etaMinDays ?? 1} className="input" /></div><div><label className="label" htmlFor={`m2-${k}`}>max</label><input id={`m2-${k}`} name="etaMaxDays" type="number" min={0} required defaultValue={m?.etaMaxDays ?? 3} className="input" /></div></div>
      <div className="sm:col-span-2 lg:col-span-4"><label className="label" htmlFor={`md-${k}`}>Description (optional)</label><input id={`md-${k}`} name="description" defaultValue={m?.description ?? ""} className="input" /></div>
      <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="isActive" defaultChecked={m?.isActive ?? true} className="check" /> Active</label>
    </div>
  );
}
function ZoneFields({ z }: { z?: Zone }) {
  const all = z?.states.includes("*");
  return (
    <div className="space-y-3">
      {z ? <input type="hidden" name="id" value={z.id} /> : null}
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-56 flex-1"><label className="label" htmlFor={`zn-${z?.id ?? "new"}`}>Zone name</label><input id={`zn-${z?.id ?? "new"}`} name="name" required defaultValue={z?.name} placeholder="e.g. South East" className="input" /></div>
        <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="isActive" defaultChecked={z?.isActive ?? true} className="check" /> Active</label>
        <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="allOther" defaultChecked={all} className="check" /> Fallback: every state not in another zone</label>
      </div>
      <fieldset><legend className="label">States in this zone</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4 lg:grid-cols-6">{NIGERIAN_STATES.map((s) => (<label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" name="states" value={s} defaultChecked={z?.states.includes(s)} className="check" /> {s}</label>))}</div>
      </fieldset>
    </div>
  );
}

export default async function ShippingAdmin() {
  await requireStaffPage("settings.manage");
  const zones = await listShipping();
  return (
    <>
      <AdminHeader title="Delivery zones & fees" description="A customer's state decides the zone; the fee is the base fee plus the per-item fee for each item after the first. If a state has no active zone, checkout tells the customer delivery is unavailable there." />
      <div className="space-y-6">
        {zones.map((z) => (
          <Section key={z.id} title={`${z.name}${z.isActive ? "" : " (inactive)"}`}>
            <p className="px-5 pt-4 text-sm text-muted">{z.states.includes("*") ? "All states not covered by another zone" : z.states.join(", ")}</p>
            <ul className="divide-y divide-line">
              {z.methods.map((m) => (
                <li key={m.id} className="px-5 py-3 text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap justify-between gap-3"><span>{m.name}{!m.isActive ? <span className="badge ml-2">Inactive</span> : null}</span><span className="text-muted tabular-nums">{formatMoney(m.baseFee)}{m.perItemFee ? ` + ${formatMoney(m.perItemFee)}/extra item` : ""}{m.freeAbove ? ` · free above ${formatMoney(m.freeAbove)}` : ""} · {m.etaMinDays}–{m.etaMaxDays} days</span></summary>
                    <ActionForm action={saveMethodAction} className="mt-4 space-y-3"><MethodFields zoneId={z.id} m={m} /><SubmitButton className="btn-sm">Save method</SubmitButton></ActionForm>
                  </details>
                </li>
              ))}
            </ul>
            <details className="border-t border-line px-5 py-3 text-sm"><summary className="link cursor-pointer">Add a delivery method</summary><ActionForm action={saveMethodAction} resetOnSuccess className="mt-4 space-y-3"><MethodFields zoneId={z.id} /><SubmitButton className="btn-sm">Add method</SubmitButton></ActionForm></details>
            <details className="border-t border-line px-5 py-3 text-sm"><summary className="link cursor-pointer">Edit zone & states</summary><ActionForm action={saveZoneAction} className="mt-4 space-y-3"><ZoneFields z={z} /><SubmitButton className="btn-sm">Save zone</SubmitButton></ActionForm></details>
          </Section>
        ))}
        <Section title="New zone"><ActionForm action={saveZoneAction} resetOnSuccess className="space-y-3 p-5"><ZoneFields /><SubmitButton>Create zone</SubmitButton></ActionForm></Section>
      </div>
    </>
  );
}
