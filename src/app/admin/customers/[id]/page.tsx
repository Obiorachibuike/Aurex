import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateCustomerAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { ROLE_KEYS, SYSTEM_ROLES } from "@/lib/auth/permissions";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { getCustomer } from "@/services/admin";
import { listTaxonomy } from "@/services/admin-catalog";
import { hasPermission } from "@/services/auth";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerAdmin({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage("customers.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c, t] = await Promise.all([getCustomer(id), listTaxonomy()]);
  if (!c) notFound();
  const canManage = hasPermission(actor, "customers.manage");
  const canStaff = hasPermission(actor, "staff.manage");
  const editable = canManage && (!c.role.isStaff || canStaff);
  const ws = c.profile?.wholesaleStatus ?? "NONE";
  return (
    <>
      <AdminHeader title={c.user.name} description={<>{c.user.email}{c.user.phone ? ` · ${c.user.phone}` : ""} · joined {formatDate(c.user.createdAt)} · {c.user.emailVerifiedAt ? "email verified" : "email not verified"}</>} actions={<Link href="/admin/customers" className="btn btn-outline btn-sm">Back</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Section title={`Orders (${c.orders.length})`}>
            {c.orders.length ? (
              <div className="overflow-x-auto"><table className="table"><thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr></thead><tbody>
                {c.orders.map((o) => (<tr key={o.id}><td><Link href={`/admin/orders/${o.id}`} className="link font-mono text-xs">{o.number}</Link>{o.pricingTier === "WHOLESALE" ? <span className="badge badge-gold ml-2">Wholesale</span> : null}</td><td className="text-muted">{formatDate(o.createdAt)}</td><td><StatusBadge status={o.status} /></td><td className="text-right tabular-nums">{formatMoney(o.total)}</td></tr>))}
              </tbody></table></div>
            ) : <p className="p-5 text-sm text-muted">No orders yet.</p>}
          </Section>
          {c.applications.length ? (
            <Section title="Wholesale applications">
              <ul className="divide-y divide-line">
                {c.applications.map((a) => (<li key={a.id} className="px-5 py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{a.businessName} <span className="font-normal text-muted">· {a.businessType}</span></span><StatusBadge status={a.status} /></div><p className="mt-1 text-xs text-faint">{a.address}, {a.state} · {formatDate(a.createdAt)}{a.reviewNote ? ` · ${a.reviewNote}` : ""}</p></li>))}
              </ul>
            </Section>
          ) : null}
          {c.tickets.length ? (
            <Section title="Support tickets">
              <ul className="divide-y divide-line">{c.tickets.map((tk) => (<li key={tk.id} className="flex justify-between gap-3 px-5 py-3 text-sm"><Link href={`/admin/support/${tk.id}`} className="link">{tk.number} — {tk.subject}</Link><StatusBadge status={tk.status} /></li>))}</ul>
            </Section>
          ) : null}
        </div>
        <div className="space-y-6">
          <Section title="Account">
            <div className="space-y-5 p-5 text-sm">
              <p>Role: <strong>{c.role.name}</strong>{c.user.isSuspended ? <span className="badge badge-red ml-2">Suspended</span> : null}</p>
              {editable ? (
                <>
                  {!c.role.isStaff ? (
                    <ActionForm action={updateCustomerAction} className="space-y-3">
                      <input type="hidden" name="userId" value={c.user.id} />
                      <div><label className="label" htmlFor="ws">Wholesale status</label><select id="ws" name="wholesaleStatus" defaultValue={ws} className="input">{["NONE", "PENDING", "APPROVED", "REJECTED"].map((s) => (<option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>))}</select><p className="hint">Only “Approved” unlocks wholesale prices.</p></div>
                      <div><label className="label" htmlFor="grp">Customer group</label><select id="grp" name="groupId" defaultValue={c.profile?.groupId ?? ""} className="input"><option value="">No group</option>{t.groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}</select></div>
                      <SubmitButton className="btn-sm">Save</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {canStaff && c.user.id !== actor.id ? (
                    <ActionForm action={updateCustomerAction} className="space-y-3 border-t border-line pt-4">
                      <input type="hidden" name="userId" value={c.user.id} />
                      <div><label className="label" htmlFor="role">Role</label><select id="role" name="role" defaultValue={c.role.key} className="input">{ROLE_KEYS.map((k) => (<option key={k} value={k}>{SYSTEM_ROLES[k].name}</option>))}</select><p className="hint">Changing a role signs the person out everywhere.</p></div>
                      <SubmitButton className="btn-outline btn-sm" confirm="Change this account's role?">Change role</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {c.user.id !== actor.id ? (
                    <ActionForm action={updateCustomerAction} className="border-t border-line pt-4">
                      <input type="hidden" name="userId" value={c.user.id} /><input type="hidden" name="suspend" value={c.user.isSuspended ? "false" : "true"} />
                      <SubmitButton className={c.user.isSuspended ? "btn-outline btn-sm" : "btn-danger btn-sm"} confirm={c.user.isSuspended ? undefined : "Suspend this account? They will be signed out and unable to sign in."}>{c.user.isSuspended ? "Lift suspension" : "Suspend account"}</SubmitButton>
                    </ActionForm>
                  ) : null}
                </>
              ) : <p className="text-xs text-faint">You can view this account but not change it.</p>}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
