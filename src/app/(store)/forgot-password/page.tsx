import type { Metadata } from "next";
import Link from "next/link";
import { forgotPasswordAction } from "@/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <div className="container-x max-w-md py-12 sm:py-16">
      <h1 className="text-3xl font-semibold">Forgot your password?</h1>
      <p className="mt-2 text-sm text-muted">Enter your email and we&apos;ll send a link to choose a new one.</p>
      <ActionForm action={forgotPasswordAction} inlineSuccess resetOnSuccess className="panel mt-6 space-y-4 p-5">
        <div>
          <label htmlFor="email" className="label">Email address</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </div>
        <SubmitButton className="w-full">Send reset link</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-muted"><Link href="/login" className="link">Back to sign in</Link></p>
    </div>
  );
}
