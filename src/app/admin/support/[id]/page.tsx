import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateTicketAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { getTicket } from "@/services/admin";

export const metadata: Metadata = { title: "Ticket" };

export default async function TicketAdmin({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage("support.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await getTicket(id);
  if (!row) notFound();
  const t = row.ticket;
  return (
    <>
      <AdminHeader title={`${t.number} — ${t.subject}`} description={`Opened ${formatDate(t.createdAt, true)} · assigned to ${row.assignee ?? "nobody yet"}`} actions={<><StatusBadge status={t.status} /><Link href="/admin/support" className="btn btn-outline btn-sm">Back</Link></>} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Message">
          <div className="space-y-3 p-5 text-sm">
            <p className="whitespace-pre-line">{t.message}</p>
            <p className="border-t border-line pt-3 text-muted">{t.name} · <a className="link" href={`mailto:${t.email}?subject=${encodeURIComponent(`Re: ${t.subject} [${t.number}]`)}`}>{t.email}</a>{t.phone ? ` · ${t.phone}` : ""}</p>
            {t.conversationId ? <p><Link href={`/admin/ai/conversations/${t.conversationId}`} className="btn btn-outline btn-sm">Open the chat & reply there</Link></p> : null}
          </div>
        </Section>
        <Section title="Handle ticket">
          <ActionForm action={updateTicketAction} className="space-y-4 p-5">
            <input type="hidden" name="id" value={t.id} />
            <div><label className="label" htmlFor="status">Status</label><select id="status" name="status" defaultValue={t.status} className="input"><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option></select></div>
            <div><label className="label" htmlFor="notes">Internal notes (staff only)</label><textarea id="notes" name="internalNotes" rows={5} defaultValue={t.internalNotes ?? ""} className="input" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="assignToMe" className="check" /> Assign to me</label>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
