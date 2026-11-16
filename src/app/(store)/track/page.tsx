import { PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { trackOrderAction } from "@/actions/checkout";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Track your order", description: "Check the status of your AUREX order with your order number and email address.", alternates: { canonical: "/track" } };

export default async function TrackPage() {
  const { user } = await getViewer();
  return (
    <div className="container-x max-w-xl py-12 sm:py-16">
      <div className="mb-6 flex size-12 items-center justify-center rounded-full border border-line bg-card text-gold"><PackageSearch className="size-5" aria-hidden /></div>
      <h1 className="text-3xl font-semibold">Track your order</h1>
      <p className="mt-2 text-muted">Enter the order number from your confirmation email and the email address you used at checkout.</p>
      <ActionForm action={trackOrderAction} className="panel mt-7 space-y-4 p-5">
        <div>
          <label htmlFor="number" className="label">Order number</label>
          <input id="number" name="number" required placeholder="AUR-000000-XXXXXX" autoCapitalize="characters" autoComplete="off" className="input font-mono uppercase" />
        </div>
        <div>
          <label htmlFor="email" className="label">Email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" defaultValue={user?.email ?? ""} className="input" />
        </div>
        <SubmitButton className="w-full" pendingLabel="Looking up your order…">Track order</SubmitButton>
      </ActionForm>
      {user ? <p className="mt-5 text-sm text-muted">Signed in? See all your orders in <Link href="/account/orders" className="link">your account</Link>.</p> : null}
    </div>
  );
}
