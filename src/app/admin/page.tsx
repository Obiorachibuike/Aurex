import Link from "next/link";
import { BarList, DailyChart, Section, Stat } from "@/components/admin/bits";
import { AdminHeader } from "@/components/admin/bits";
import { StatusBadge } from "@/components/ui/bits";
import { hasPermission } from "@/services/auth";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { getOverview } from "@/services/admin";
import { ORDER_STATUS_LABELS } from "@/services/orders";

export default async function AdminOverview() {
  const user = await requireStaffPage();
  const o = await getOverview();
  const money = hasPermission(user, "payments.manage");
  return (
    <>
      <AdminHeader title="Overview" description="Revenue counts only orders whose payment was verified with the gateway, excluding refunded and cancelled orders." />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {money ? <Stat label="Revenue today" value={formatMoney(o.today)} tone="gold" /> : null}
        {money ? <Stat label="This month" value={formatMoney(o.month)} /> : null}
        {money ? <Stat label="All-time revenue" value={formatMoney(o.revenue)} hint={`${o.paidOrders} paid orders`} /> : null}
        {money ? <Stat label="Wholesale revenue" value={formatMoney(o.wholesaleRevenue)} hint={`${o.wholesaleOrders} orders`} /> : null}
        <Stat label="To fulfil" value={o.toFulfil} hint="Paid, processing or ready" href="/admin/orders?status=PAID" tone={o.toFulfil ? "gold" : undefined} />
        <Stat label="Awaiting payment" value={o.pending} href="/admin/orders?status=AWAITING_PAYMENT" />
        <Stat label="Delivered" value={o.completed} hint={`${o.totalOrders} orders in total`} />
        <Stat label="Orders via AI assistant" value={o.aiOrders} href="/admin/ai" />
        <Stat label="Customers" value={o.customers} hint={`${o.newCustomers} new this month · ${o.wholesaleCustomers} wholesale`} href="/admin/customers" />
        <Stat label="Wholesale applications" value={o.wholesalePending} href="/admin/wholesale" tone={o.wholesalePending ? "warn" : undefined} />
        <Stat label="Refund requests" value={o.refundsOpen} href="/admin/payments" tone={o.refundsOpen ? "warn" : undefined} />
        <Stat label="Open support tickets" value={o.openTickets} href="/admin/support" tone={o.openTickets ? "warn" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {money ? <Section title="Revenue — last 14 days"><DailyChart days={o.daily.map((d) => ({ day: d.day, value: d.revenue }))} format={formatMoney} /></Section> : null}
        <Section title="Orders by status"><BarList rows={Object.entries(o.byStatus).map(([s, c]) => ({ label: ORDER_STATUS_LABELS[s as keyof typeof ORDER_STATUS_LABELS] ?? s, value: c }))} /></Section>
        <Section title="Best-selling products"><BarList rows={o.bestSellers.map((b) => ({ label: b.name, sub: b.sku, value: b.units }))} format={(n) => `${n} sold`} /></Section>
        <Section title="Orders by state"><BarList rows={o.byState.map((s) => ({ label: s.state, value: s.count }))} format={(n) => `${n} orders`} /></Section>
        <Section title="Low stock" actions={<Link href="/admin/inventory?view=low" className="link text-sm">View all</Link>}>
          {o.lowStock.length ? (
            <div className="overflow-x-auto"><table className="table"><thead><tr><th>Product</th><th>SKU</th><th className="text-right">Available</th></tr></thead><tbody>
              {o.lowStock.map((r) => (<tr key={r.variantId}><td><Link href={`/admin/products/${r.productId}`} className="hover:text-gold-bright">{r.productName}</Link></td><td className="font-mono text-xs text-muted">{r.sku}</td><td className="text-right"><span className={`badge ${r.available <= 0 ? "badge-red" : "badge-amber"}`}>{r.available}</span></td></tr>))}
            </tbody></table></div>
          ) : <p className="p-5 text-sm text-muted">Every active product is above its low-stock threshold.</p>}
        </Section>
        {money ? (
          <Section title="Recent payments" actions={<Link href="/admin/payments" className="link text-sm">View all</Link>}>
            {o.recentPayments.length ? (
              <div className="overflow-x-auto"><table className="table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="text-right">Amount</th></tr></thead><tbody>
                {o.recentPayments.map((p) => (<tr key={p.id}><td><Link href={`/admin/orders?q=${p.orderNumber}`} className="link font-mono text-xs">{p.orderNumber}</Link><div className="text-[11px] text-faint">{formatDate(p.createdAt, true)}</div></td><td>{p.customer}</td><td><StatusBadge status={p.status} /></td><td className="text-right tabular-nums">{formatMoney(p.amount)}</td></tr>))}
              </tbody></table></div>
            ) : <p className="p-5 text-sm text-muted">No payments yet.</p>}
          </Section>
        ) : null}
      </div>
    </>
  );
}
