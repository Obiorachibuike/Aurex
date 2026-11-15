import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, SearchForm } from "@/components/admin/bits";
import { Pagination, StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import type { OrderStatus } from "@/services/order-shared";
import { listOrdersAdmin, ORDER_STATUS_LABELS } from "@/services/orders";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersAdmin({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  await requireStaffPage("orders.view");
  const sp = await searchParams;
  const status = sp.status && sp.status in ORDER_STATUS_LABELS ? (sp.status as OrderStatus) : undefined;
  const r = await listOrdersAdmin({ q: sp.q, status, page: Number(sp.page) || 1 });
  return (
    <>
      <AdminHeader title="Orders" description={`${r.total} order(s)`} />
      <SearchForm action="/admin/orders" q={sp.q} placeholder="Order number, name, email or phone">
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className="input w-auto"><option value="">All statuses</option>{Object.entries(ORDER_STATUS_LABELS).map(([k, l]) => (<option key={k} value={k}>{l}</option>))}</select>
      </SearchForm>
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead><tr><th>Order</th><th>Customer</th><th>Destination</th><th>Status</th><th>Type</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {r.rows.map((o) => (
              <tr key={o.id} data-testid="admin-order-row">
                <td><Link href={`/admin/orders/${o.id}`} className="link font-mono text-xs">{o.number}</Link><div className="text-[11px] text-faint">{formatDate(o.createdAt, true)}</div></td>
                <td>{o.customerName}<div className="text-xs text-faint">{o.email}</div></td>
                <td className="text-muted">{o.shippingAddress.city}, {o.shippingAddress.state}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="space-x-1">{o.pricingTier === "WHOLESALE" ? <span className="badge badge-gold">Wholesale</span> : null}{o.source === "AI" ? <span className="badge">AI</span> : null}{!o.userId ? <span className="badge">Guest</span> : null}</td>
                <td className="text-right tabular-nums">{formatMoney(o.total)}</td>
              </tr>
            ))}
            {!r.rows.length ? <tr><td colSpan={6} className="py-10 text-center text-muted">No orders match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-5"><Pagination page={r.page} pageCount={r.pageCount} hrefFor={(p) => `/admin/orders?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(status ? { status } : {}), page: String(p) })}`} /></div>
    </>
  );
}
