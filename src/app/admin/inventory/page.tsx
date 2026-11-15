import type { Metadata } from "next";
import Link from "next/link";
import { adjustStockAction } from "@/actions/admin";
import { AdminHeader, SearchForm, Section, Stat, Tabs } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Pagination } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { getInventoryReport, listMovements } from "@/services/admin";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryAdmin({ searchParams }: { searchParams: Promise<{ q?: string; view?: string; page?: string }> }) {
  await requireStaffPage("inventory.manage");
  const sp = await searchParams;
  const view = sp.view === "low" || sp.view === "out" ? sp.view : "all";
  const [r, moves] = await Promise.all([getInventoryReport({ q: sp.q, view, page: Number(sp.page) || 1 }), listMovements(25)]);
  const base = (v: string) => `/admin/inventory${v === "all" ? "" : `?view=${v}`}`;
  return (
    <>
      <AdminHeader title="Inventory" description="“Available” is stock on hand minus units reserved by unpaid orders. Every change is recorded as a stock movement." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="SKUs" value={r.summary.skus} />
        <Stat label="Units on hand" value={r.summary.units} hint={`${r.summary.reserved} reserved`} />
        <Stat label="Stock value (retail)" value={formatMoney(r.summary.retailValue)} />
        <Stat label="Low stock" value={r.summary.low} tone={r.summary.low ? "warn" : undefined} href={base("low")} />
        <Stat label="Out of stock" value={r.summary.out} tone={r.summary.out ? "warn" : undefined} href={base("out")} />
      </div>
      <Tabs current={base(view)} tabs={[[base("all"), "All"], [base("low"), "Low stock", r.summary.low], [base("out"), "Out of stock", r.summary.out]]} />
      <SearchForm action="/admin/inventory" q={sp.q} placeholder="Search product or SKU">{view !== "all" ? <input type="hidden" name="view" value={view} /> : null}</SearchForm>
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead><tr><th>Product</th><th className="text-right">On hand</th><th className="text-right">Reserved</th><th className="text-right">Available</th><th>Adjust</th></tr></thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.variantId} data-testid="inventory-row" data-sku={x.sku}>
                <td><Link href={`/admin/products/${x.productId}`} className="font-medium hover:text-gold-bright">{x.productName}</Link><div className="text-xs text-faint"><span className="font-mono">{x.sku}</span> · {x.variantName} · alert at {x.threshold}</div></td>
                <td className="text-right tabular-nums" data-testid="on-hand">{x.onHand}</td>
                <td className="text-right tabular-nums text-muted">{x.reserved}</td>
                <td className="text-right"><span className={`badge ${x.available <= 0 ? "badge-red" : x.available <= x.threshold ? "badge-amber" : "badge-green"}`}>{x.available}</span></td>
                <td>
                  <ActionForm action={adjustStockAction} resetOnSuccess className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="variantId" value={x.variantId} />
                    <select name="mode" aria-label="Adjustment type" className="input w-auto px-2 py-1.5 text-xs"><option value="DELTA">Add / remove</option><option value="SET">Set count to</option></select>
                    <input name="value" type="number" required aria-label="Quantity" placeholder="e.g. 10 or -2" className="input w-28 px-2 py-1.5 text-xs" />
                    <input name="note" aria-label="Note" placeholder="Note (optional)" maxLength={200} className="input w-40 px-2 py-1.5 text-xs" />
                    <SubmitButton className="btn-outline btn-sm">Apply</SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
            {!r.rows.length ? <tr><td colSpan={5} className="py-10 text-center text-muted">Nothing here.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="my-5"><Pagination page={r.page} pageCount={r.pageCount} hrefFor={(p) => `/admin/inventory?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(view !== "all" ? { view } : {}), page: String(p) })}`} /></div>
      <Section title="Recent stock movements">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="text-right">Change</th><th>By</th><th>Note</th></tr></thead>
            <tbody>
              {moves.map((m) => (<tr key={m.id}><td className="whitespace-nowrap text-muted">{formatDate(m.createdAt, true)}</td><td>{m.productName}<div className="font-mono text-xs text-faint">{m.sku}</div></td><td><span className="badge">{m.type.replace(/_/g, " ").toLowerCase()}</span></td><td className={`text-right tabular-nums ${m.quantity < 0 ? "text-danger" : "text-success"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td><td className="text-muted">{m.actor ?? "System"}</td><td className="text-muted">{m.note ?? ""}</td></tr>))}
              {!moves.length ? <tr><td colSpan={6} className="py-8 text-center text-muted">No movements yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
