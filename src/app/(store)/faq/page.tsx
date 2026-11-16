import type { Metadata } from "next";
import Link from "next/link";
import { OpenChatButton } from "@/components/store/chat-widget";
import { PageHeader } from "@/components/ui/bits";
import { listKnowledge } from "@/services/ai/knowledge";

export const metadata: Metadata = { title: "Frequently asked questions", description: "Answers about ordering, payment, delivery, compatibility, warranty and returns at AUREX.", alternates: { canonical: "/faq" } };

export default async function FaqPage() {
  const faqs = await listKnowledge("FAQ");
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.title, acceptedAnswer: { "@type": "Answer", text: f.content } })) };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <PageHeader eyebrow="Help" title="Frequently asked questions">Quick answers to the questions we hear most.</PageHeader>
      <div className="container-x max-w-3xl py-10">
        {faqs.length ? (
          <div className="panel divide-y divide-line">
            {faqs.map((f) => (
              <details key={f.id} className="group px-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden">
                  {f.title}
                  <span className="text-xl leading-none text-gold transition-transform group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="pb-5 text-sm leading-relaxed whitespace-pre-line text-muted">{f.content}</p>
              </details>
            ))}
          </div>
        ) : (
          <p className="panel p-6 text-sm text-muted">No questions have been published yet.</p>
        )}
        <p className="mt-8 text-sm text-muted">
          Still need help? <OpenChatButton className="link">Ask the assistant</OpenChatButton> or <Link href="/contact" className="link">contact support</Link>.
        </p>
      </div>
    </>
  );
}
