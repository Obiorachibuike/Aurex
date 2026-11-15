import { BadgePercent, Boxes, ClipboardList, Headset } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/bits";
import { getViewer } from "@/lib/viewer";
import { getKnowledgeDoc } from "@/services/ai/knowledge";

export const metadata: Metadata = { title: "Wholesale for repair shops & resellers", description: "Apply for an AUREX wholesale account: trade pricing, bulk discounts and a dedicated order history for phone repair businesses.", alternates: { canonical: "/wholesale" } };

export default async function WholesalePage() {
  const [{ user }, doc] = await Promise.all([getViewer(), getKnowledgeDoc("wholesale-policy")]);
  const cta = !user ? { href: "/register?next=/account/wholesale", label: "Create an account to apply" } : user.wholesaleApproved ? { href: "/account/wholesale", label: "Open wholesale dashboard" } : { href: "/account/wholesale", label: user.wholesaleStatus === "PENDING" ? "View my application" : "Apply for wholesale" };
  return (
    <>
      <PageHeader eyebrow="For the trade" title="Wholesale pricing for repair businesses">Lower unit prices, bulk tiers and priority support for technicians, repair shops and resellers.</PageHeader>
      <div className="container-x py-10">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[[BadgePercent, "Trade prices", "Wholesale unit prices on eligible parts once your account is approved."], [Boxes, "Bulk discounts", "Extra savings at higher quantities, shown clearly on each product."], [ClipboardList, "Order history", "A dashboard of your wholesale orders and spend."], [Headset, "Priority support", "Help from people who understand repair work."]].map(([I, t, d]) => {
            const Icon = I as typeof Boxes;
            return (
              <li key={t as string} className="card p-5">
                <Icon className="size-6 text-gold" aria-hidden />
                <h2 className="mt-3 font-semibold">{t as string}</h2>
                <p className="mt-1.5 text-sm text-muted">{d as string}</p>
              </li>
            );
          })}
        </ul>
        <div className="mt-10 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
          <article className="prose-policy whitespace-pre-line">{doc?.content}</article>
          <aside className="panel h-fit p-6">
            <h2 className="text-lg font-semibold">How to apply</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>Create a free AUREX account.</li>
              <li>Tell us about your business.</li>
              <li>We review and reply, usually within 2 business days.</li>
              <li>Wholesale prices appear automatically when you sign in.</li>
            </ol>
            <Link href={cta.href} className="btn btn-gold mt-6 w-full">{cta.label}</Link>
          </aside>
        </div>
      </div>
    </>
  );
}
