"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="mt-2 text-3xl font-semibold">We hit a problem loading this page</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">Please try again. If it keeps happening, contact support{error.digest ? ` and quote reference ${error.digest}` : ""}.</p>
      <div className="mt-7 flex gap-3">
        <button type="button" onClick={reset} className="btn btn-gold">Try again</button>
        <Link href="/" className="btn btn-outline">Back to home</Link>
      </div>
    </main>
  );
}
