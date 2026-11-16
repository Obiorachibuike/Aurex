import { NIGERIAN_STATES } from "@/lib/nigeria";

type A = { id?: string; label?: string | null; fullName?: string; phone?: string; line1?: string; line2?: string | null; city?: string; state?: string; isDefault?: boolean };

export function AddressFields({ a = {}, prefix = "addr" }: { a?: A; prefix?: string }) {
  const id = (k: string) => `${prefix}-${k}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {a.id ? <input type="hidden" name="id" value={a.id} /> : null}
      <div><label htmlFor={id("label")} className="label">Label (optional)</label><input id={id("label")} name="label" defaultValue={a.label ?? ""} maxLength={40} placeholder="Home, Shop…" className="input" /></div>
      <div><label htmlFor={id("fullName")} className="label">Recipient name</label><input id={id("fullName")} name="fullName" required defaultValue={a.fullName ?? ""} autoComplete="name" className="input" /></div>
      <div><label htmlFor={id("phone")} className="label">Phone number</label><input id={id("phone")} name="phone" type="tel" required defaultValue={a.phone ?? ""} autoComplete="tel" placeholder="0803 123 4567" className="input" /></div>
      <div><label htmlFor={id("line1")} className="label">Street address</label><input id={id("line1")} name="line1" required defaultValue={a.line1 ?? ""} autoComplete="address-line1" className="input" /></div>
      <div><label htmlFor={id("line2")} className="label">Landmark (optional)</label><input id={id("line2")} name="line2" defaultValue={a.line2 ?? ""} className="input" /></div>
      <div><label htmlFor={id("city")} className="label">City / town</label><input id={id("city")} name="city" required defaultValue={a.city ?? ""} autoComplete="address-level2" className="input" /></div>
      <div>
        <label htmlFor={id("state")} className="label">State</label>
        <select id={id("state")} name="state" required defaultValue={a.state ?? ""} className="input">
          <option value="">Select state</option>
          {NIGERIAN_STATES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>
      <label className="flex items-center gap-2.5 self-end pb-3 text-sm text-muted"><input type="checkbox" name="isDefault" defaultChecked={a.isDefault} className="check" /> Use as my default address</label>
    </div>
  );
}
