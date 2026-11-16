import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader, Tabs } from "@/components/admin/bits";
import { StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { listTickets } from "@/services/admin";

export const metadata: Metadata = { title: "Support" };
const VIEWS = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

export default async function SupportAdmin({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaffPage("support.manage");
  const sp = await searchParams;
  const status = VIEWS.find((s) => s === sp.status);
  const rows = await listTickets(status);
  const base = (s?: string) => `/admin/support${s ? `?status=${s}` : ""}`;
  return (
    <>
      <AdminHeader title="Support tickets" description="Requests from the contact form and conversations the AI assistant handed over to a person." />
      <Tabs current={base(status)} tabs={[[base(), "All"], [base("OPEN"), "Open"], [base("IN_PROGRESS"), "In progress"], [base("RESOLVED"), "Resolved"]]} />
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead><tr><th>Ticket</th><th>From</th><th>Source</th><th>Status</th><th>Assigned</th><th>Opened</th></tr></thead>
          <tbody>
            {rows.map(({ ticket: t, assignee }) => (
              <tr key={t.id}>
                <td><Link href={`/admin/support/${t.id}`} className="link">{t.number}</Link><div className="max-w-xs truncate text-xs text-muted">{t.subject}</div></td>
                <td>{t.name}<div className="text-xs text-faint">{t.email}</div></td>
                <td><span className="badge">{t.source === "AI_ESCALATION" ? "AI handover" : "Contact form"}</span></td>
                <td><StatusBadge status={t.status} /></td>
                <td className="text-muted">{assignee ?? "—"}</td>
                <td className="whitespace-nowrap text-muted">{formatDate(t.createdAt, true)}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={6} className="py-10 text-center text-muted">No tickets here.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
