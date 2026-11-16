import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { agentReplyAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { getConversationAdmin } from "@/services/admin";
import { hasPermission } from "@/services/auth";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationAdmin({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("admin.access");
  if (!hasPermission(user, "ai.manage") && !hasPermission(user, "support.manage")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getConversationAdmin(id);
  if (!c) notFound();
  return (
    <>
      <AdminHeader title={c.conv.title ?? "Conversation"} description={`${c.customer ?? "Guest"}${c.email ? ` · ${c.email}` : ""} · started ${formatDate(c.conv.createdAt, true)}`} actions={<><StatusBadge status={c.conv.status} /><Link href="/admin/ai" className="btn btn-outline btn-sm">Back</Link></>} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Transcript">
          <ol className="space-y-3 p-5">
            {c.messages.map((m) => (
              <li key={m.id} className={cn("max-w-[85%] rounded-xl px-4 py-2.5 text-sm", m.role === "user" ? "ml-auto bg-gold/15" : m.role === "agent" ? "border border-gold/40 bg-card" : "bg-card")}>
                <p className="mb-1 text-[11px] tracking-wider text-faint uppercase">{m.role === "user" ? "Customer" : m.role === "agent" ? "Staff" : "Assistant"} · {formatDate(m.createdAt, true)}{m.unresolved ? " · unanswered" : ""}{m.feedback === 1 ? " · 👍" : m.feedback === -1 ? " · 👎" : ""}</p>
                <p className="whitespace-pre-line">{m.content}</p>
              </li>
            ))}
          </ol>
          {hasPermission(user, "support.manage") ? (
            <ActionForm action={agentReplyAction} resetOnSuccess className="border-t border-line p-5">
              <input type="hidden" name="conversationId" value={c.conv.id} />
              <label className="label" htmlFor="reply">Reply as a person</label>
              <textarea id="reply" name="content" required rows={3} maxLength={2000} className="input" placeholder="The customer sees this in their chat window." />
              <SubmitButton className="mt-3">Send reply</SubmitButton>
            </ActionForm>
          ) : null}
        </Section>
        <div className="space-y-6">
          {c.orders.length ? <Section title="Orders from this chat"><ul className="divide-y divide-line">{c.orders.map((o) => (<li key={o.number} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><Link href={`/admin/orders?q=${o.number}`} className="link font-mono text-xs">{o.number}</Link><span className="flex items-center gap-2"><StatusBadge status={o.status} /><span className="tabular-nums">{formatMoney(o.total)}</span></span></li>))}</ul></Section> : null}
          {c.tickets.length ? <Section title="Tickets"><ul className="divide-y divide-line">{c.tickets.map((t) => (<li key={t.id} className="flex justify-between gap-3 px-5 py-3 text-sm"><Link href={`/admin/support/${t.id}`} className="link">{t.number}</Link><StatusBadge status={t.status} /></li>))}</ul></Section> : null}
          <Section title={`Tool calls (${c.tools.length})`}>
            {c.tools.length ? (
              <ul className="divide-y divide-line">
                {c.tools.map((t) => (
                  <li key={t.id} className="px-5 py-2.5 text-xs">
                    <details>
                      <summary className="flex cursor-pointer justify-between gap-3"><span className="font-mono">{t.toolName}</span><span className={t.status === "OK" ? "text-faint" : "text-danger"}>{t.status} · {t.durationMs} ms</span></summary>
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-bg p-2 text-[11px] whitespace-pre-wrap text-muted">{JSON.stringify({ input: t.input, output: t.output }, null, 1).slice(0, 3000)}</pre>
                    </details>
                  </li>
                ))}
              </ul>
            ) : <p className="p-5 text-sm text-muted">No tools were used.</p>}
          </Section>
        </div>
      </div>
    </>
  );
}
