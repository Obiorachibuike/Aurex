import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { safeNext } from "@/lib/auth/session";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const { user } = await getViewer();
  if (user) redirect("/account");
  const next = safeNext(sp.next, "");
  return (
    <div className="container-x max-w-md py-12 sm:py-16">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-sm text-muted">Track orders, save addresses and apply for wholesale pricing.</p>
      <ActionForm action={registerAction} className="panel mt-6 space-y-4 p-5">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="name" className="label">Full name</label>
          <input id="name" name="name" required minLength={2} autoComplete="name" className="input" />
        </div>
        <div>
          <label htmlFor="email" className="label">Email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </div>
        <div>
          <label htmlFor="phone" className="label">Phone number (optional)</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" className="input" />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" aria-describedby="pw-hint" className="input" />
          <p id="pw-hint" className="hint">At least 10 characters, with a letter and a number.</p>
        </div>
        <label className="flex items-start gap-2.5 text-sm text-muted">
          <input type="checkbox" name="terms" required className="check mt-0.5" />
          <span>I agree to the <Link href="/policies/terms" className="link" target="_blank">terms</Link> and <Link href="/policies/privacy" className="link" target="_blank">privacy policy</Link>.</span>
        </label>
        <SubmitButton className="w-full" pendingLabel="Creating your account…">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-muted">Already have an account? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="link">Sign in</Link></p>
    </div>
  );
}
