import type { Metadata } from "next";
import Link from "next/link";
import { moderateReviewAction, saveCouponAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Stars, StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { listReviewsAdmin } from "@/services/account";
import { listCoupons } from "@/services/admin-catalog";

export const metadata: Metadata = { title: "Coupons & reviews" };
const dt = (d: Date | null) => (d ? new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16) : "");

type Coupon = Awaited<ReturnType<typeof listCoupons>>[number];
function CouponFields({ c }: { c?: Coupon }) {
  const k = c?.id ?? "new";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <div><label className="label" htmlFor={`code-${k}`}>Code</label><input id={`code-${k}`} name="code" required defaultValue={c?.code} placeholder="WELCOME10" className="input font-mono uppercase" /></div>
      <div><label className="label" htmlFor={`type-${k}`}>Type</label><select id={`type-${k}`} name="type" defaultValue={c?.type ?? "PERCENT"} className="input"><option value="PERCENT">Percent off</option><option value="FIXED">Fixed amount off (₦)</option><option value="FREE_SHIPPING">Free delivery</option></select></div>
      <div><label className="label" htmlFor={`val-${k}`}>Value</label><input id={`val-${k}`} name="value" inputMode="decimal" defaultValue={c ? (c.type === "FIXED" ? c.value / 100 : c.value) : ""} placeholder="10 or 2000" className="input" /><p className="hint">Ignored for free delivery.</p></div>
      <div><label className="label" htmlFor={`min-${k}`}>Minimum spend (₦)</label><input id={`min-${k}`} name="minSubtotal" inputMode="decimal" defaultValue={c ? c.minSubtotal / 100 : ""} className="input" /></div>
      <div><label className="label" htmlFor={`max-${k}`}>Max discount (₦)</label><input id={`max-${k}`} name="maxDiscount" inputMode="decimal" defaultValue={c?.maxDiscount ? c.maxDiscount / 100 : ""} className="input" /></div>
      <div><label className="label" htmlFor={`ul-${k}`}>Total uses allowed</label><input id={`ul-${k}`} name="usageLimit" type="number" min={1} defaultValue={c?.usageLimit ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`pc-${k}`}>Uses per customer</label><input id={`pc-${k}`} name="perCustomerLimit" type="number" min={1} defaultValue={c?.perCustomerLimit ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`d-${k}`}>Description</label><input id={`d-${k}`} name="description" defaultValue={c?.description ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`s-${k}`}>Starts (Lagos time)</label><input id={`s-${k}`} name="startsAt" type="datetime-local" defaultValue={dt(c?.startsAt ?? null)} className="input" /></div>
      <div><label className="label" htmlFor={`e-${k}`}>Ends (Lagos time)</label><input id={`e-${k}`} name="endsAt" type="datetime-local" defaultValue={dt(c?.endsAt ?? null)} className="input" /></div>
      <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="appliesToWholesale" defaultChecked={c?.appliesToWholesale} className="check" /> Also valid on wholesale prices</label>
      <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="isActive" defaultChecked={c?.isActive ?? true} className="check" /> Active</label>
    </div>
  );
}

export default async function MarketingAdmin() {
  await requireStaffPage("marketing.manage");
  const [coupons, reviews] = await Promise.all([listCoupons(), listReviewsAdmin()]);
  const pending = reviews.filter((r) => r.review.status === "PENDING");
  return (
    <>
      <AdminHeader title="Coupons & reviews" />
      <Section title={`Coupons (${coupons.length})`} className="mb-6">
        <ul className="divide-y divide-line">
          {coupons.map((c) => (
            <li key={c.id} className="px-5 py-3 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                  <span><span className="font-mono font-medium text-gold-bright">{c.code}</span> <span className="ml-2 text-muted">{c.type === "PERCENT" ? `${c.value}% off` : c.type === "FIXED" ? `${formatMoney(c.value)} off` : "Free delivery"}{c.minSubtotal ? ` · min ${formatMoney(c.minSubtotal)}` : ""}</span></span>
                  <span className="text-xs text-faint">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ""} used · {c.isActive ? "active" : "inactive"}{c.endsAt ? ` · ends ${formatDate(c.endsAt)}` : ""}</span>
                </summary>
                <ActionForm action={saveCouponAction} className="mt-4 space-y-3"><CouponFields c={c} /><SubmitButton className="btn-sm">Save coupon</SubmitButton></ActionForm>
              </details>
            </li>
          ))}
        </ul>
        <ActionForm action={saveCouponAction} resetOnSuccess className="space-y-3 border-t border-line p-5">
          <h3 className="font-medium">New coupon</h3>
          <CouponFields />
          <SubmitButton>Create coupon</SubmitButton>
        </ActionForm>
      </Section>
      <Section title={`Reviews awaiting moderation (${pending.length})`}>
        {reviews.length ? (
          <ul className="divide-y divide-line">
            {[...pending, ...reviews.filter((r) => r.review.status !== "PENDING").slice(0, 30)].map(({ review: r, product, slug }) => (
              <li key={r.id} className="px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Stars value={r.rating} /> <span className="font-medium">{r.authorName}</span>{r.isVerifiedPurchase ? <span className="badge badge-green">Verified purchase</span> : null}{r.isDemo ? <span className="badge">Demo</span> : null}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1 text-xs text-faint">on <Link href={`/products/${slug}`} className="link">{product}</Link> · {formatDate(r.createdAt)}</p>
                {r.title ? <p className="mt-2 font-medium">{r.title}</p> : null}
                <p className="mt-1 text-muted">{r.body}</p>
                <ActionForm action={moderateReviewAction} className="mt-3 flex gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  {r.status !== "APPROVED" ? <SubmitButton name="status" value="APPROVED" className="btn-sm">Publish</SubmitButton> : null}
                  {r.status !== "REJECTED" ? <SubmitButton name="status" value="REJECTED" className="btn-outline btn-sm">{r.status === "APPROVED" ? "Unpublish" : "Reject"}</SubmitButton> : null}
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : <p className="p-5 text-sm text-muted">No reviews yet.</p>}
      </Section>
    </>
  );
}
