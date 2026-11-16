import Link from "next/link";
import { updateProfileAction } from "@/actions/account";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { getProfile } from "@/services/account";
import { listOrdersForUser } from "@/services/orders";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser("/account");
  const [profile, orders, sp] = await Promise.all([getProfile(user.id), listOrdersForUser(user.id, 3), searchParams]);
  const prefs = profile?.profile?.preferences ?? {};
  return (
    <div className="space-y-6">
      {sp.welcome ? <p role="status" className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-[#b5efd2]">Welcome to AUREX! Your account is ready.</p> : null}
      <section className="panel p-5 sm:p-6" aria-labelledby="recent-h">
        <div className="flex items-center justify-between">
          <h2 id="recent-h" className="text-lg font-semibold">Recent orders</h2>
          <Link href="/account/orders" className="link text-sm">View all</Link>
        </div>
        {orders.length ? (
          <ul className="mt-4 divide-y divide-line">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <Link href={`/orders/${o.number}`} className="font-mono font-medium hover:text-gold-bright">{o.number}</Link>
                  <p className="text-xs text-faint">{formatDate(o.createdAt)} · {o.items.reduce((n, i) => n + i.quantity, 0)} item(s)</p>
                </div>
                <div className="flex items-center gap-3"><StatusBadge status={o.status} /><span className="tabular-nums">{formatMoney(o.total)}</span></div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">You haven&apos;t placed an order yet. <Link href="/products" className="link">Start shopping</Link></p>
        )}
      </section>

      <section className="panel p-5 sm:p-6" aria-labelledby="profile-h">
        <h2 id="profile-h" className="text-lg font-semibold">Profile & preferences</h2>
        <ActionForm action={updateProfileAction} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="name" className="label">Full name</label><input id="name" name="name" required defaultValue={profile?.name ?? ""} autoComplete="name" className="input" /></div>
            <div><label htmlFor="phone" className="label">Phone number</label><input id="phone" name="phone" type="tel" defaultValue={profile?.phone ?? ""} autoComplete="tel" placeholder="0803 123 4567" className="input" /></div>
            <div><label htmlFor="email" className="label">Email address</label><input id="email" value={profile?.email ?? ""} readOnly className="input opacity-70" /></div>
            <div><label htmlFor="primaryDevice" className="label">Phone you repair or use most (optional)</label><input id="primaryDevice" name="primaryDevice" defaultValue={prefs.primaryDevice ?? ""} maxLength={80} placeholder="e.g. Samsung Galaxy A15 4G" className="input" /></div>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-muted"><input type="checkbox" name="orderUpdatesByEmail" defaultChecked={prefs.orderUpdatesByEmail !== false} className="check" /> Email me updates about my orders</label>
          <label className="flex items-center gap-2.5 text-sm text-muted"><input type="checkbox" name="marketingOptIn" defaultChecked={profile?.profile?.marketingOptIn ?? false} className="check" /> Send me new arrivals and offers</label>
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
