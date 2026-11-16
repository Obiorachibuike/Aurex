import { and, eq, sql } from "drizzle-orm";
import { BadgeCheck, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { wholesaleApplyAction } from "@/actions/account";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { NIGERIAN_STATES } from "@/lib/nigeria";
import { formatDate, formatMoney } from "@/lib/utils";
import { latestApplication } from "@/services/account";

export const metadata: Metadata = { title: "Wholesale" };

export default async function WholesaleAccountPage() {
  const user = await requireUser("/account/wholesale");
  const application = await latestApplication(user.id);

  if (user.wholesaleApproved) {
    // Scoped to this user: the dashboard can only ever show the signed-in account's own wholesale orders.
    const mine = and(eq(orders.userId, user.id), eq(orders.pricingTier, "WHOLESALE"));
    const [[stats], recent] = await Promise.all([
      db.select({ count: sql<number>`count(*) filter (where ${orders.paidAt} is not null)::int`, spent: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.paidAt} is not null and ${orders.status} not in ('REFUNDED','CANCELLED')), 0)`, saved: sql<number>`coalesce((select sum((oi.list_price - oi.unit_price) * oi.quantity) from order_items oi join orders o on o.id = oi.order_id where o.user_id = ${user.id} and o.pricing_tier = 'WHOLESALE' and o.paid_at is not null and o.status not in ('REFUNDED','CANCELLED')), 0)` }).from(orders).where(mine),
      db.select().from(orders).where(mine).orderBy(sql`${orders.createdAt} desc`).limit(20),
    ]);
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3 rounded-xl border border-gold/40 bg-gold/10 p-4">
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-gold-bright" aria-hidden />
          <div>
            <p className="font-semibold text-gold-bright">Wholesale account active{application?.businessName ? ` — ${application.businessName}` : ""}</p>
            <p className="mt-0.5 text-sm text-muted">Wholesale prices apply automatically when you order at or above each product&apos;s minimum quantity.</p>
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[["Paid wholesale orders", String(stats?.count ?? 0)], ["Total spent", formatMoney(Number(stats?.spent ?? 0))], ["Saved vs retail", formatMoney(Number(stats?.saved ?? 0))]].map(([k, v]) => (
            <div key={k} className="card p-5"><dt className="text-xs tracking-wider text-faint uppercase">{k}</dt><dd className="mt-2 text-2xl font-semibold text-gold-bright tabular-nums">{v}</dd></div>
          ))}
        </dl>
        <section className="panel" aria-labelledby="wo-h">
          <h2 id="wo-h" className="border-b border-line px-5 py-3.5 font-semibold">Wholesale order history</h2>
          {recent.length ? (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Order</th><th>Date</th><th>Status</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {recent.map((o) => (
                    <tr key={o.id}>
                      <td><Link href={`/orders/${o.number}`} className="link font-mono">{o.number}</Link></td>
                      <td className="text-muted">{formatDate(o.createdAt)}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="text-right tabular-nums">{formatMoney(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm text-muted">No wholesale orders yet. <Link href="/products" className="link">Browse the catalogue</Link> — your prices are already applied.</p>
          )}
        </section>
      </div>
    );
  }

  if (user.wholesaleStatus === "PENDING") {
    return (
      <div className="panel flex items-start gap-3 p-5">
        <Clock className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div>
          <h2 className="font-semibold">Your application is being reviewed</h2>
          <p className="mt-1 text-sm text-muted">Submitted {formatDate(application?.createdAt)} for {application?.businessName}. We usually reply within 2 business days by email.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Apply for a wholesale account</h2>
      <p className="mt-1 text-sm text-muted">For repair shops, technicians and resellers. <Link href="/wholesale" className="link">How wholesale works</Link></p>
      {user.wholesaleStatus === "REJECTED" ? <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm text-[#f6d7a5]">Your previous application was not approved{application?.reviewNote ? `: ${application.reviewNote}` : "."} You can apply again with updated details.</p> : null}
      <ActionForm action={wholesaleApplyAction} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="businessName" className="label">Business name</label><input id="businessName" name="businessName" required maxLength={120} className="input" /></div>
          <div>
            <label htmlFor="businessType" className="label">Business type</label>
            <select id="businessType" name="businessType" required defaultValue="" className="input">
              <option value="" disabled>Select…</option>
              {["Phone repair shop", "Independent technician", "Parts reseller", "Phone retailer", "Corporate / fleet", "Other"].map((t) => (<option key={t}>{t}</option>))}
            </select>
          </div>
          <div><label htmlFor="registrationNumber" className="label">CAC registration number (optional)</label><input id="registrationNumber" name="registrationNumber" maxLength={40} className="input" /></div>
          <div><label htmlFor="phone" className="label">Business phone</label><input id="phone" name="phone" type="tel" required defaultValue={user.phone ?? ""} placeholder="0803 123 4567" className="input" /></div>
          <div className="sm:col-span-2"><label htmlFor="address" className="label">Business address</label><input id="address" name="address" required maxLength={250} className="input" /></div>
          <div>
            <label htmlFor="state" className="label">State</label>
            <select id="state" name="state" required defaultValue="" className="input"><option value="" disabled>Select state</option>{NIGERIAN_STATES.map((s) => (<option key={s}>{s}</option>))}</select>
          </div>
          <div>
            <label htmlFor="expectedMonthlyVolume" className="label">Expected monthly spend (optional)</label>
            <select id="expectedMonthlyVolume" name="expectedMonthlyVolume" defaultValue="" className="input"><option value="">Prefer not to say</option>{["Under ₦200,000", "₦200,000 – ₦1,000,000", "₦1,000,000 – ₦5,000,000", "Above ₦5,000,000"].map((t) => (<option key={t}>{t}</option>))}</select>
          </div>
          <div className="sm:col-span-2"><label htmlFor="notes" className="label">Anything else we should know? (optional)</label><textarea id="notes" name="notes" maxLength={1000} rows={3} className="input" /></div>
        </div>
        <SubmitButton pendingLabel="Submitting…">Submit application</SubmitButton>
      </ActionForm>
    </section>
  );
}
