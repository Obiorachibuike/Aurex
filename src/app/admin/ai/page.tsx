import type { Metadata } from "next";
import Link from "next/link";
import { dismissUnresolvedAction, saveAiSettingsAction } from "@/actions/admin";
import { AdminHeader, BarList, Section, Stat, Tabs } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDate, formatMoney } from "@/lib/utils";
import { getAiUsage, listConversations, listUnresolved } from "@/services/admin";
import { getSetting } from "@/services/settings";

export const metadata: Metadata = { title: "AI assistant" };
const VIEWS = ["all", "escalated", "unresolved"] as const;

export default async function AiAdmin({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  await requireStaffPage("ai.manage");
  const sp = await searchParams;
  const view = VIEWS.find((v) => v === sp.view) ?? "all";
  const [usage, convs, unresolved, ai] = await Promise.all([getAiUsage(30), listConversations({ view, page: Number(sp.page) || 1 }), listUnresolved(40), getSetting("ai")]);
  const keys: Record<string, boolean> = { builtin: true, agnes: !!env.ai.agnesKey, openai: !!env.ai.openaiKey, custom: !!env.ai.customKey };
  const base = (v: string) => `/admin/ai${v === "all" ? "" : `?view=${v}`}`;
  return (
    <>
      <AdminHeader title="AI assistant" description="The assistant only reads product, price, stock and order data through audited server tools, and cannot place an order without the customer's explicit confirmation." actions={<Link href="/admin/ai/knowledge" className="btn btn-gold">Knowledge base</Link>} />
      {!keys[ai.provider] ? <p role="alert" className="mb-5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-[#f6d7a5]">The selected provider “{ai.provider}” has no API key on the server, so the assistant is running on the built-in engine. Add the key as an environment variable (see README) and redeploy.</p> : null}
      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Conversations (30 days)" value={usage.conversations} hint={`${usage.questions} customer messages`} />
        <Stat label="Handed to a person" value={usage.escalated} tone={usage.escalated ? "warn" : undefined} href={base("escalated")} />
        <Stat label="Unanswered questions" value={usage.unresolved} tone={usage.unresolved ? "warn" : undefined} href={base("unresolved")} />
        <Stat label="Feedback" value={`${usage.thumbsUp} 👍 · ${usage.thumbsDown} 👎`} />
        <Stat label="Orders created by AI" value={usage.aiOrders} hint={`${usage.aiOrdersPaid} paid`} />
        <Stat label="AI order revenue" value={formatMoney(usage.aiRevenue)} tone="gold" />
        <Stat label="Tokens used" value={(usage.promptTokens + usage.completionTokens).toLocaleString("en-NG")} hint={`${usage.promptTokens.toLocaleString("en-NG")} in · ${usage.completionTokens.toLocaleString("en-NG")} out`} />
        <Stat label="Estimated cost" value={usage.ratesConfigured ? `$${usage.estimatedCostUsd.toFixed(2)}` : "—"} hint={usage.ratesConfigured ? "Estimate from your configured rates" : "Set per-1k token rates below"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Settings">
          <ActionForm action={saveAiSettingsAction} className="space-y-4 p-5">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={ai.enabled} className="check" /> Assistant enabled</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="orderingEnabled" defaultChecked={ai.orderingEnabled} className="check" /> Allow ordering through chat</label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="provider">Provider</label>
                <select id="provider" name="provider" defaultValue={ai.provider} className="input">
                  <option value="builtin">Built-in engine (no API key)</option>
                  <option value="agnes">Agnes AI{keys.agnes ? "" : " — key missing"}</option>
                  <option value="openai">OpenAI{keys.openai ? "" : " — key missing"}</option>
                  <option value="custom">Custom OpenAI-compatible{keys.custom ? "" : " — key missing"}</option>
                </select>
              </div>
              <div><label className="label" htmlFor="model">Model</label><input id="model" name="model" required defaultValue={ai.model} className="input font-mono" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="baseUrl">Custom API URL (custom provider only)</label><input id="baseUrl" name="baseUrl" type="url" defaultValue={ai.baseUrl} placeholder="https://…/v1" className="input" /></div>
              <div><label className="label" htmlFor="temperature">Temperature (0–1)</label><input id="temperature" name="temperature" type="number" step="0.05" min={0} max={1} defaultValue={ai.temperature} className="input" /></div>
              <div><label className="label" htmlFor="maxTokens">Max reply tokens</label><input id="maxTokens" name="maxTokens" type="number" min={100} max={4000} defaultValue={ai.maxTokens} className="input" /></div>
              <div><label className="label" htmlFor="cp">Cost per 1k prompt tokens (USD)</label><input id="cp" name="costPer1kPromptUsd" type="number" step="0.0001" min={0} defaultValue={ai.costPer1kPromptUsd} className="input" /></div>
              <div><label className="label" htmlFor="cc">Cost per 1k completion tokens (USD)</label><input id="cc" name="costPer1kCompletionUsd" type="number" step="0.0001" min={0} defaultValue={ai.costPer1kCompletionUsd} className="input" /></div>
            </div>
            <div><label className="label" htmlFor="extra">Extra instructions (tone, greetings…)</label><textarea id="extra" name="extraInstructions" rows={3} maxLength={2000} defaultValue={ai.extraInstructions} className="input" /><p className="hint">These cannot override the safety rules: no invented prices, stock or compatibility; no order without confirmation.</p></div>
            <SubmitButton>Save AI settings</SubmitButton>
          </ActionForm>
        </Section>
        <div className="space-y-6">
          <Section title="Tool usage (30 days)"><BarList rows={usage.tools.map((t) => ({ label: t.tool, sub: `${t.avgMs ?? 0} ms avg${t.failed ? ` · ${t.failed} failed` : ""}`, value: t.calls }))} format={(n) => `${n} calls`} /></Section>
          <Section title="Replies by model">
            {usage.byModel.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>Provider</th><th>Model</th><th className="text-right">Replies</th><th className="text-right">Tokens</th></tr></thead><tbody>{usage.byModel.map((m) => (<tr key={m.provider + m.model}><td>{m.provider}</td><td className="font-mono text-xs">{m.model}</td><td className="text-right tabular-nums">{m.replies}</td><td className="text-right tabular-nums">{(m.prompt + m.completion).toLocaleString("en-NG")}</td></tr>))}</tbody></table></div> : <p className="p-5 text-sm text-muted">No replies yet.</p>}
          </Section>
        </div>
      </div>

      <Section title={`Questions to fix (${unresolved.length})`} className="mt-6">
        {unresolved.length ? (
          <ul className="divide-y divide-line">
            {unresolved.map((u) => (
              <li key={u.id} className="px-5 py-3 text-sm">
                <p className="font-medium">“{u.question}”{u.feedback === -1 ? <span className="badge badge-red ml-2">Marked unhelpful</span> : null}</p>
                <p className="mt-1 text-muted">Assistant: {u.answer}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-faint">{formatDate(u.createdAt, true)}</span>
                  <Link href={`/admin/ai/conversations/${u.conversationId}`} className="link">View conversation</Link>
                  <Link href="/admin/ai/knowledge" className="link">Add an answer to the knowledge base</Link>
                  <ActionForm action={dismissUnresolvedAction}><input type="hidden" name="id" value={u.id} /><SubmitButton className="btn-ghost btn-sm">Mark handled</SubmitButton></ActionForm>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="p-5 text-sm text-muted">Nothing waiting — the assistant answered everything it was asked.</p>}
      </Section>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Conversations</h2>
      <Tabs current={base(view)} tabs={[[base("all"), "All"], [base("escalated"), "Handed to a person"], [base("unresolved"), "With unanswered questions"]]} />
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead><tr><th>Conversation</th><th>Customer</th><th>Status</th><th className="text-right">Messages</th><th>Last activity</th></tr></thead>
          <tbody>
            {convs.rows.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/admin/ai/conversations/${c.id}`} className="link">{c.title ?? "Conversation"}</Link><div className="max-w-sm truncate text-xs text-muted">{c.lastMessage}</div></td>
                <td>{c.customer ?? "Guest"}<div className="text-xs text-faint">{c.email}</div></td>
                <td><StatusBadge status={c.status} />{c.hasUnresolved ? <span className="badge badge-amber ml-1">Unanswered</span> : null}</td>
                <td className="text-right tabular-nums">{c.messages}</td>
                <td className="whitespace-nowrap text-muted">{formatDate(c.updatedAt, true)}</td>
              </tr>
            ))}
            {!convs.rows.length ? <tr><td colSpan={5} className="py-10 text-center text-muted">No conversations yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex gap-2">
        {convs.page > 1 ? <Link className="btn btn-outline btn-sm" href={`/admin/ai?${new URLSearchParams({ ...(view !== "all" ? { view } : {}), page: String(convs.page - 1) })}`}>Newer</Link> : null}
        {convs.hasMore ? <Link className="btn btn-outline btn-sm" href={`/admin/ai?${new URLSearchParams({ ...(view !== "all" ? { view } : {}), page: String(convs.page + 1) })}`}>Older</Link> : null}
      </div>
    </>
  );
}
