import type { Metadata } from "next";
import { createSupplierAction, createWarehouseAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { listPurchaseOrders, listSuppliers, listWarehouses } from "@/services/procurement";

export const metadata: Metadata = { title: "Suppliers & purchasing" };

export default async function SuppliersAdmin() {
  await requireStaffPage("inventory.manage");
  const [suppliers, warehouses, pos] = await Promise.all([listSuppliers(), listWarehouses(), listPurchaseOrders()]);
  return (
    <>
      <AdminHeader title="Suppliers & purchasing" description="Manage suppliers, warehouses, and purchase orders for stock replenishment." />

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Suppliers">
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Name</th><th>Contact</th><th>Lead time</th><th>Status</th></tr></thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td><div className="font-medium">{s.name}</div><div className="text-xs text-faint">{s.email ?? s.phone ?? ""}</div></td>
                    <td className="text-muted">{s.contactName ?? "—"}</td>
                    <td className="text-muted">{s.leadTimeDays != null ? `${s.leadTimeDays} days` : "—"}</td>
                    <td><span className={`badge ${s.isActive ? "badge-green" : ""}`}>{s.isActive ? "Active" : "Inactive"}</span></td>
                  </tr>
                ))}
                {!suppliers.length ? <tr><td colSpan={4} className="py-8 text-center text-muted">No suppliers yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <details className="border-t border-line p-4">
            <summary className="link cursor-pointer text-sm">Add supplier</summary>
            <ActionForm action={createSupplierAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="s-name">Supplier name</label><input id="s-name" name="name" required className="input" /></div>
              <div><label className="label" htmlFor="s-contact">Contact name</label><input id="s-contact" name="contactName" className="input" /></div>
              <div><label className="label" htmlFor="s-email">Email</label><input id="s-email" name="email" type="email" className="input" /></div>
              <div><label className="label" htmlFor="s-phone">Phone</label><input id="s-phone" name="phone" className="input" /></div>
              <div><label className="label" htmlFor="s-lead">Lead time (days)</label><input id="s-lead" name="leadTimeDays" type="number" min={0} className="input" /></div>
              <div><label className="label" htmlFor="s-terms">Payment terms</label><input id="s-terms" name="paymentTerms" className="input" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="s-notes">Notes</label><textarea id="s-notes" name="notes" className="input" rows={2} /></div>
              <div className="sm:col-span-2"><SubmitButton>Create supplier</SubmitButton></div>
            </ActionForm>
          </details>
        </Section>

        <Section title="Warehouses">
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Warehouse</th><th>Location</th><th>Stock value</th><th>Status</th></tr></thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.id}>
                    <td><div className="font-medium">{w.name} {w.isDefault ? <span className="badge badge-gold ml-1">Default</span> : null}</div><div className="text-xs text-faint">{w.code}</div></td>
                    <td className="text-muted">{[w.city, w.state].filter(Boolean).join(", ") || "—"}</td>
                    <td className="text-muted">{formatMoney(Number(w.stockValue || 0))}</td>
                    <td><span className={`badge ${w.isActive ? "badge-green" : ""}`}>{w.isActive ? "Active" : "Inactive"}</span></td>
                  </tr>
                ))}
                {!warehouses.length ? <tr><td colSpan={4} className="py-8 text-center text-muted">No warehouses yet. Add one to track stock by location.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <details className="border-t border-line p-4">
            <summary className="link cursor-pointer text-sm">Add warehouse</summary>
            <ActionForm action={createWarehouseAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="w-name">Name</label><input id="w-name" name="name" required className="input" /></div>
              <div><label className="label" htmlFor="w-code">Code</label><input id="w-code" name="code" required className="input" placeholder="e.g. LAG-MAIN" /></div>
              <div><label className="label" htmlFor="w-city">City</label><input id="w-city" name="city" className="input" /></div>
              <div><label className="label" htmlFor="w-state">State</label><input id="w-state" name="state" className="input" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="w-address">Address</label><input id="w-address" name="address" className="input" /></div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="isDefault" className="check" /> Default warehouse</label>
              <div className="sm:col-span-2"><SubmitButton>Create warehouse</SubmitButton></div>
            </ActionForm>
          </details>
        </Section>
      </div>

      <Section title="Recent purchase orders" className="mt-6">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Total</th><th>Created</th></tr></thead>
            <tbody>
              {pos.map(({ po, supplier }) => (
                <tr key={po.id}>
                  <td className="font-medium">{po.number}</td>
                  <td className="text-muted">{supplier}</td>
                  <td><span className="badge">{po.status.replace(/_/g, " ")}</span></td>
                  <td className="text-muted">{formatMoney(po.total, po.currency)}</td>
                  <td className="text-muted whitespace-nowrap">{formatDate(po.createdAt, true)}</td>
                </tr>
              ))}
              {!pos.length ? <tr><td colSpan={5} className="py-8 text-center text-muted">No purchase orders yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
