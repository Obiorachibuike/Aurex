import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { safeNext } from "@/lib/auth/session";
import { getViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const { user } = await getViewer();
  if (user) redirect(safeNext(sp.next, user.isStaff ? "/admin" : "/account"));
  const next = safeNext(sp.next, "");
  return (
    <div className="container-x max-w-md py-12 sm:py-16">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-muted">Welcome back. Sign in to see your orders, addresses and saved items.</p>
      {sp.reset ? <p role="status" className="mt-5 rounded-lg border border-success/40 bg-success/10 px-3.5 py-2.5 text-sm text-[#b5efd2]">Your password has been changed. Sign in with the new password.</p> : null}
      <ActionForm action={loginAction} className="panel mt-6 space-y-4 p-5">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="email" className="label">Email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" autoFocus className="input" />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="label">Password</label>
            <Link href="/forgot-password" className="link text-xs">Forgot password?</Link>
          </div>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
        </div>
        <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-muted">
        New to AUREX? <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="link">Create an account</Link>
      </p>
    </div>
  );
}
