import type { Metadata } from "next";
import Link from "next/link";
import { deleteKnowledgeAction, saveKnowledgeAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { listKnowledgeAdmin, PROTECTED_KNOWLEDGE } from "@/services/admin-catalog";

export const metadata: Metadata = { title: "Knowledge base" };
const TYPES = [["FAQ", "FAQ"], ["POLICY", "Policy"], ["BUSINESS", "Business info"], ["WHOLESALE", "Wholesale"]] as const;
type Doc = Awaited<ReturnType<typeof listKnowledgeAdmin>>[number];

function Fields({ d }: { d?: Doc }) {
  const k = d?.id ?? "new";
  return (
    <div className="space-y-3">
      {d ? <input type="hidden" name="id" value={d.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_7rem]">
        <div><label className="label" htmlFor={`t-${k}`}>{d?.type === "FAQ" || !d ? "Question / title" : "Title"}</label><input id={`t-${k}`} name="title" required defaultValue={d?.title} className="input" /></div>
        <div><label className="label" htmlFor={`ty-${k}`}>Type</label><select id={`ty-${k}`} name="type" defaultValue={d?.type ?? "FAQ"} className="input">{TYPES.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}</select></div>
        <div><label className="label" htmlFor={`so-${k}`}>Order</label><input id={`so-${k}`} name="sortOrder" type="number" defaultValue={d?.sortOrder ?? 0} className="input" /></div>
      </div>
      <div><label className="label" htmlFor={`c-${k}`}>Answer / content</label><textarea id={`c-${k}`} name="content" required rows={d ? 8 : 4} defaultValue={d?.content} className="input" /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPublished" defaultChecked={d?.isPublished ?? true} className="check" /> Published (used by the assistant and shown in the store)</label>
    </div>
  );
}

export default async function KnowledgeAdmin() {
  await requireStaffPage("ai.manage");
  const docs = await listKnowledgeAdmin();
  return (
    <>
      <AdminHeader title="Knowledge base" description="The assistant answers policy and business questions only from these entries, and the FAQ and policy pages in the store are rendered from them too. Changes apply immediately." actions={<Link href="/admin/ai" className="btn btn-outline">Back</Link>} />
      <Section title="Add an entry" className="mb-6"><ActionForm action={saveKnowledgeAction} resetOnSuccess className="space-y-3 p-5"><Fields /><SubmitButton>Add entry</SubmitButton></ActionForm></Section>
      {TYPES.map(([type, label]) => {
        const rows = docs.filter((d) => d.type === type);
        if (!rows.length) return null;
        return (
          <Section key={type} title={`${label} (${rows.length})`} className="mb-6">
            <ul className="divide-y divide-line">
              {rows.map((d) => (
                <li key={d.id} className="px-5 py-3 text-sm">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap justify-between gap-3"><span>{d.title}{!d.isPublished ? <span className="badge ml-2">Unpublished</span> : null}</span><span className="text-xs text-faint">updated {formatDate(d.updatedAt)}</span></summary>
                    <ActionForm action={saveKnowledgeAction} className="mt-4 space-y-3"><Fields d={d} /><SubmitButton className="btn-sm">Save</SubmitButton></ActionForm>
                    {!PROTECTED_KNOWLEDGE.includes(d.slug) ? <ActionForm action={deleteKnowledgeAction} className="mt-2"><input type="hidden" name="id" value={d.id} /><SubmitButton className="btn-ghost btn-sm" confirm="Delete this entry?">Delete</SubmitButton></ActionForm> : <p className="mt-2 text-xs text-faint">This page is linked from the store and cannot be deleted, only edited.</p>}
                  </details>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </>
  );
}
