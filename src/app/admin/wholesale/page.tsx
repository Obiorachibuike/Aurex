import type { Metadata } from "next";
import Link from "next/link";
import { deleteRuleAction, saveGroupAction, saveRuleAction, wholesaleDecisionAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { listApplications } from "@/services/admin";
import { listProductsAdmin, listRules, listTaxonomy } from "@/services/admin-catalog";

export const metadata: Metadata = { title: "Wholesale" };

export default async function WholesaleAdmin() {
  await requireStaffPage("customers.manage");
  const [apps, rules, t, prods] = await Promise.all([listApplications("PENDING"), listRules(), listTaxonomy(), listProductsAdmin({ pageSize: 100 })]);
  return (
    <>
      <AdminHeader title="Wholesale" description="Approve trade accounts and set bulk pricing. Each product's base wholesale price and minimum quantity are set on the product; rules below add extra tiers." />
      <Section title={`Applications awaiting review (${apps.length})`} className="mb-6">
        {apps.length ? (
          <ul className="divide-y divide-line">
            {apps.map(({ application: a, name, email }) => (
              <li key={a.id} className="px-5 py-4 text-sm" data-testid="wholesale-application">
                <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{a.businessName} <span className="font-normal text-muted">· {a.businessType}</span></p><p className="text-xs text-faint">{formatDate(a.createdAt, true)}</p></div>
                <p className="mt-1 text-muted"><Link href={`/admin/customers/${a.userId}`} className="link">{name}</Link> · {email} · {a.phone}</p>
                <p className="text-muted">{a.address}, {a.state}{a.registrationNumber ? ` · CAC ${a.registrationNumber}` : ""}{a.expectedMonthlyVolume ? ` · ${a.expectedMonthlyVolume}` : ""}</p>
                {a.notes ? <p className="mt-1.5 rounded-lg bg-card p-3">{a.notes}</p> : null}
                <ActionForm action={wholesaleDecisionAction} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="applicationId" value={a.id} />
                  <select name="groupId" aria-label="Customer group" className="input w-auto"><option value="">No group</option>{t.groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}</select>
                  <input name="note" aria-label="Note to applicant" placeholder="Note to applicant (optional)" className="input max-w-xs" />
                  <SubmitButton name="decision" value="approve" className="btn-sm" data-testid="approve-wholesale">Approve</SubmitButton>
                  <SubmitButton name="decision" value="reject" className="btn-outline btn-sm">Decline</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : <p className="p-5 text-sm text-muted">No applications are waiting.</p>}
      </Section>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Bulk price rules">
          {rules.length ? (
            <div className="overflow-x-auto"><table className="table"><thead><tr><th>Rule</th><th>Applies to</th><th>Group</th><th className="text-right">From qty</th><th className="text-right">Price</th><th><span className="sr-only">Remove</span></th></tr></thead><tbody>
              {rules.map(({ rule: r, product, category, group }) => (<tr key={r.id}><td>{r.name}</td><td className="text-muted">{product ?? (category ? `Category: ${category}` : "All wholesale products")}</td><td className="text-muted">{group ?? "All wholesale"}</td><td className="text-right tabular-nums">{r.minQuantity}+</td><td className="text-right tabular-nums">{r.priceType === "FIXED" ? formatMoney(r.value) : `${r.value}% off`}</td><td><ActionForm action={deleteRuleAction} className="flex justify-end"><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn-ghost btn-sm" confirm="Remove this price rule?">Remove</SubmitButton></ActionForm></td></tr>))}
            </tbody></table></div>
          ) : <p className="p-5 text-sm text-muted">No extra tiers yet.</p>}
          <ActionForm action={saveRuleAction} resetOnSuccess className="grid gap-3 border-t border-line p-5 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label" htmlFor="r-name">Rule name</label><input id="r-name" name="name" required placeholder="e.g. 20+ units — 5% off" className="input" /></div>
            <div><label className="label" htmlFor="r-prod">Product (optional)</label><select id="r-prod" name="productId" className="input"><option value="">Any product</option>{prods.rows.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
            <div><label className="label" htmlFor="r-cat">Category (optional)</label><select id="r-cat" name="categoryId" className="input"><option value="">Any category</option>{t.categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></div>
            <div><label className="label" htmlFor="r-grp">Customer group</label><select id="r-grp" name="groupId" className="input"><option value="">All wholesale customers</option>{t.groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}</select></div>
            <div><label className="label" htmlFor="r-min">Minimum quantity</label><input id="r-min" name="minQuantity" type="number" min={1} required defaultValue={10} className="input" /></div>
            <div><label className="label" htmlFor="r-type">Price type</label><select id="r-type" name="priceType" className="input"><option value="PERCENT_OFF">Percent off the wholesale price</option><option value="FIXED">Fixed unit price in ₦ (needs a product)</option></select></div>
            <div><label className="label" htmlFor="r-val">Value</label><input id="r-val" name="value" required inputMode="decimal" placeholder="5 or 32000" className="input" /></div>
            <div className="sm:col-span-2"><SubmitButton>Add rule</SubmitButton></div>
          </ActionForm>
        </Section>
        <Section title="Customer groups">
          <ul className="divide-y divide-line">{t.groups.map((g) => (<li key={g.id} className="px-5 py-3 text-sm">{g.name}{g.description ? <span className="block text-xs text-faint">{g.description}</span> : null}</li>))}{!t.groups.length ? <li className="px-5 py-3 text-sm text-muted">No groups yet.</li> : null}</ul>
          <ActionForm action={saveGroupAction} resetOnSuccess className="space-y-3 border-t border-line p-5">
            <div><label className="label" htmlFor="g-name">New group</label><input id="g-name" name="name" required placeholder="e.g. Gold partners" className="input" /></div>
            <div><label className="label" htmlFor="g-desc">Description (optional)</label><input id="g-desc" name="description" className="input" /></div>
            <SubmitButton className="btn-sm">Create group</SubmitButton>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
