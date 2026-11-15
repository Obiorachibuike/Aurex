import type { Metadata } from "next";
import Link from "next/link";
import { resetPasswordAction } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  return (
    <div className="container-x max-w-md py-12 sm:py-16">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      {!token ? (
        <p className="panel mt-6 p-5 text-sm text-muted">This link is incomplete. <Link href="/forgot-password" className="link">Request a new reset link</Link>.</p>
      ) : (
        <ActionForm action={resetPasswordAction} className="panel mt-6 space-y-4 p-5">
          <input type="hidden" name="token" value={token} />
          <div>
            <label htmlFor="password" className="label">New password</label>
            <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" />
            <p className="hint">At least 10 characters, with a letter and a number.</p>
          </div>
          <div>
            <label htmlFor="confirm" className="label">Confirm new password</label>
            <input id="confirm" name="confirm" type="password" required autoComplete="new-password" className="input" />
          </div>
          <SubmitButton className="w-full">Update password</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
