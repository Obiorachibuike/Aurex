import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmail } from "@/services/auth";

export const metadata: Metadata = { title: "Verify your email", robots: { index: false }, referrer: "no-referrer" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token;
  const ok = token ? await verifyEmail(token) : false;
  return (
    <div className="container-x max-w-md py-16 text-center">
      {ok ? <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden /> : <XCircle className="mx-auto size-12 text-danger" aria-hidden />}
      <h1 className="mt-5 text-2xl font-semibold">{ok ? "Email verified" : "This link is invalid or has expired"}</h1>
      <p className="mt-2 text-sm text-muted">{ok ? "Thank you — your email address is confirmed." : "Sign in and request a new verification email from your account page."}</p>
      <Link href="/account" className="btn btn-gold mt-7">Go to my account</Link>
    </div>
  );
}
