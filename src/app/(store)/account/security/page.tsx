import type { Metadata } from "next";
import { changePasswordAction } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <section className="panel max-w-lg p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Change password</h2>
      <p className="mt-1 text-sm text-muted">Changing your password signs you out on your other devices.</p>
      <ActionForm action={changePasswordAction} resetOnSuccess className="mt-5 space-y-4">
        <div><label htmlFor="current" className="label">Current password</label><input id="current" name="current" type="password" required autoComplete="current-password" className="input" /></div>
        <div><label htmlFor="password" className="label">New password</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" /><p className="hint">At least 10 characters, with a letter and a number.</p></div>
        <div><label htmlFor="confirm" className="label">Confirm new password</label><input id="confirm" name="confirm" type="password" required autoComplete="new-password" className="input" /></div>
        <SubmitButton>Update password</SubmitButton>
      </ActionForm>
    </section>
  );
}
