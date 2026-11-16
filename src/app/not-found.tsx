import Link from "next/link";
import { Logo } from "@/components/ui/bits";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo />
      <p className="eyebrow mt-10">Error 404</p>
      <h1 className="mt-2 text-3xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">It may have been moved, or the link may be incorrect.</p>
      <div className="mt-7 flex gap-3">
        <Link href="/" className="btn btn-gold">Back to home</Link>
        <Link href="/products" className="btn btn-outline">Browse products</Link>
      </div>
    </main>
  );
}
