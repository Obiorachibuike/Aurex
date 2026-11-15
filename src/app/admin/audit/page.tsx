import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, SearchForm } from "@/components/admin/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { listAuditLogs } from "@/services/admin";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditAdmin({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireStaffPage("audit.view");
  const sp = await searchParams;
  const r = await listAuditLogs({ q: sp.q, page: Number(sp.page) || 1 });
  const href = (p: number) => `/admin/audit?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;
  return (
    <>
      <AdminHeader title="Audit log" description="A permanent record of sensitive actions: sign-ins, price and stock changes, order updates, refunds, role changes and settings." />
      <SearchForm action="/admin/audit" q={sp.q} placeholder="Action, record or staff email" />
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
          <tbody>
            {r.rows.map(({ log: l, actor, actorEmail }) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-muted">{formatDate(l.createdAt, true)}</td>
                <td>{actor ?? "System"}<div className="text-xs text-faint">{actorEmail}</div></td>
                <td><span className="badge font-mono">{l.action}</span></td>
                <td className="text-xs text-muted">{l.entityType}{l.entityId ? <span className="block max-w-40 truncate font-mono text-faint">{l.entityId}</span> : null}</td>
                <td className="max-w-md text-xs text-faint"><span className="line-clamp-2 break-all">{l.metadata ? JSON.stringify(l.metadata) : ""}</span></td>
              </tr>
            ))}
            {!r.rows.length ? <tr><td colSpan={5} className="py-10 text-center text-muted">No entries.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex gap-2">{r.page > 1 ? <Link href={href(r.page - 1)} className="btn btn-outline btn-sm">Newer</Link> : null}{r.hasMore ? <Link href={href(r.page + 1)} className="btn btn-outline btn-sm">Older</Link> : null}</div>
    </>
  );
}
