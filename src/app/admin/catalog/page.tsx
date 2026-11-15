import type { Metadata } from "next";
import { saveBrandAction, saveCategoryAction, saveDeviceAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requireStaffPage } from "@/lib/auth/session";
import { listTaxonomy } from "@/services/admin-catalog";

export const metadata: Metadata = { title: "Categories & devices" };

export default async function CatalogAdmin() {
  await requireStaffPage("products.manage");
  const t = await listTaxonomy();
  return (
    <>
      <AdminHeader title="Categories, brands & device models" description="Device models and their aliases drive compatibility search and the AI assistant. If two models share a nickname (e.g. “A15”), the store asks the customer which one they mean." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={`Categories (${t.categories.length})`}>
          <ul className="divide-y divide-line">
            {t.categories.map((c) => (
              <li key={c.id} className="px-5 py-3">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm"><span>{c.name} <span className="text-xs text-faint">/{c.slug}</span></span>{!c.isActive ? <span className="badge">Hidden</span> : null}</summary>
                  <ActionForm action={saveCategoryAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="id" value={c.id} />
                    <div><label className="label" htmlFor={`cn-${c.id}`}>Name</label><input id={`cn-${c.id}`} name="name" required defaultValue={c.name} className="input" /></div>
                    <div><label className="label" htmlFor={`co-${c.id}`}>Sort order</label><input id={`co-${c.id}`} name="sortOrder" type="number" defaultValue={c.sortOrder} className="input" /></div>
                    <div className="sm:col-span-2"><label className="label" htmlFor={`cd-${c.id}`}>Description</label><input id={`cd-${c.id}`} name="description" defaultValue={c.description ?? ""} className="input" /></div>
                    <div className="sm:col-span-2"><label className="label" htmlFor={`ck-${c.id}`}>Search keywords (comma-separated)</label><input id={`ck-${c.id}`} name="keywords" defaultValue={(c.keywords ?? []).join(", ")} className="input" /></div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={c.isActive} className="check" /> Visible in store</label>
                    <div className="sm:col-span-2"><SubmitButton className="btn-sm">Save</SubmitButton></div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
          <ActionForm action={saveCategoryAction} resetOnSuccess className="flex flex-wrap items-end gap-3 border-t border-line p-5">
            <div className="min-w-48 flex-1"><label className="label" htmlFor="new-cat">New category</label><input id="new-cat" name="name" required className="input" /></div>
            <input type="hidden" name="isActive" value="on" />
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Section>

        <Section title={`Brands (${t.brands.length})`}>
          <ul className="flex flex-wrap gap-2 p-5">
            {t.brands.map((b) => (<li key={b.id} className={`badge ${b.isActive ? "badge-gold" : ""}`}>{b.name}</li>))}
          </ul>
          <ActionForm action={saveBrandAction} resetOnSuccess className="flex flex-wrap items-end gap-3 border-t border-line p-5">
            <div className="min-w-48 flex-1"><label className="label" htmlFor="new-brand">New brand</label><input id="new-brand" name="name" required className="input" /></div>
            <input type="hidden" name="isActive" value="on" />
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Section>

        <Section title={`Device models (${t.devices.length})`} className="xl:col-span-2">
          <ActionForm action={saveDeviceAction} resetOnSuccess className="grid gap-3 border-b border-line p-5 sm:grid-cols-2 lg:grid-cols-5">
            <div><label className="label" htmlFor="nd-brand">Brand</label><select id="nd-brand" name="brandId" required defaultValue="" className="input"><option value="" disabled>Select…</option>{t.brands.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}</select></div>
            <div><label className="label" htmlFor="nd-name">Model name</label><input id="nd-name" name="name" required placeholder="Galaxy A15 4G" className="input" /></div>
            <div><label className="label" htmlFor="nd-mn">Model numbers</label><input id="nd-mn" name="modelNumbers" placeholder="SM-A155F, SM-A155M" className="input" /></div>
            <div><label className="label" htmlFor="nd-al">Aliases</label><input id="nd-al" name="aliases" placeholder="A15, A15 4G" className="input" /></div>
            <input type="hidden" name="isActive" value="on" />
            <div className="self-end"><SubmitButton>Add device</SubmitButton></div>
          </ActionForm>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Device</th><th>Model numbers</th><th>Aliases</th><th><span className="sr-only">Edit</span></th></tr></thead>
              <tbody>
                {t.devices.map((d) => (
                  <tr key={d.id}>
                    <td>{d.brand} {d.name}{!d.isActive ? <span className="badge ml-2">Hidden</span> : null}</td>
                    <td className="font-mono text-xs text-muted">{d.modelNumbers.join(", ") || "—"}</td>
                    <td className="text-muted">{d.aliases.join(", ") || "—"}</td>
                    <td>
                      <details className="text-right">
                        <summary className="link cursor-pointer text-sm">Edit</summary>
                        <ActionForm action={saveDeviceAction} className="mt-2 grid min-w-72 gap-2 text-left">
                          <input type="hidden" name="id" value={d.id} /><input type="hidden" name="brandId" value={d.brandId} />
                          <input name="name" aria-label="Model name" required defaultValue={d.name} className="input" />
                          <input name="modelNumbers" aria-label="Model numbers" defaultValue={d.modelNumbers.join(", ")} className="input" />
                          <input name="aliases" aria-label="Aliases" defaultValue={d.aliases.join(", ")} className="input" />
                          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={d.isActive} className="check" /> Active</label>
                          <SubmitButton className="btn-sm">Save</SubmitButton>
                        </ActionForm>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
