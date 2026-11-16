import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, SearchForm, Tabs } from "@/components/admin/bits";
import { Pagination, StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { listCustomers } from "@/services/admin";

export const metadata: Metadata = { title: "Customers" };
const SEGMENTS = ["all", "wholesale", "pending", "staff"] as const;

export default async function CustomersAdmin({ searchParams }: { searchParams: Promise<{ q?: string; segment?: string; page?: string }> }) {
  await requireStaffPage("customers.view");
  const sp = await searchParams;
  const segment = SEGMENTS.find((s) => s === sp.segment) ?? "all";
  const r = await listCustomers({ q: sp.q, segment, page: Number(sp.page) || 1 });
  const base = (s: string) => `/admin/customers${s === "all" ? "" : `?segment=${s}`}`;
  return (
    <>
      <AdminHeader title="Customers" description={`${r.total} account(s)`} />
      <Tabs current={base(segment)} tabs={[[base("all"), "Everyone"], [base("wholesale"), "Wholesale"], [base("pending"), "Wholesale pending"], [base("staff"), "Staff"]]} />
      <SearchForm action="/admin/customers" q={sp.q} placeholder="Name, email, phone or business">{segment !== "all" ? <input type="hidden" name="segment" value={segment} /> : null}</SearchForm>
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead><tr><th>Customer</th><th>Role</th><th>Wholesale</th><th className="text-right">Orders</th><th className="text-right">Spent</th><th>Joined</th></tr></thead>
          <tbody>
            {r.rows.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/admin/customers/${c.id}`} className="font-medium hover:text-gold-bright">{c.name}</Link><div className="text-xs text-faint">{c.email}{c.businessName ? ` · ${c.businessName}` : ""}</div></td>
                <td>{c.role}{c.isSuspended ? <span className="badge badge-red ml-2">Suspended</span> : null}</td>
                <td>{c.wholesaleStatus && c.wholesaleStatus !== "NONE" ? <StatusBadge status={c.wholesaleStatus} /> : <span className="text-faint">—</span>}{c.group ? <span className="ml-2 text-xs text-muted">{c.group}</span> : null}</td>
                <td className="text-right tabular-nums">{c.orders}</td>
                <td className="text-right tabular-nums">{formatMoney(c.spent)}</td>
                <td className="text-muted">{formatDate(c.createdAt)}</td>
              </tr>
            ))}
            {!r.rows.length ? <tr><td colSpan={6} className="py-10 text-center text-muted">No customers match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-5"><Pagination page={r.page} pageCount={r.pageCount} hrefFor={(p) => `/admin/customers?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(segment !== "all" ? { segment } : {}), page: String(p) })}`} /></div>
    </>
  );
}
