import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/bits";
import { formatDate } from "@/lib/utils";
import { getKnowledgeDoc } from "@/services/ai/knowledge";

const PAGES: Record<string, string> = { shipping: "Shipping & delivery", returns: "Returns & refunds", warranty: "Warranty", privacy: "Privacy policy", terms: "Terms & conditions", "wholesale-policy": "Wholesale policy" };
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const title = PAGES[slug];
  return title ? { title, description: `AUREX ${title.toLowerCase()} — clear terms for customers across Nigeria.`, alternates: { canonical: `/policies/${slug}` } } : { title: "Not found" };
}

/** Policy pages are rendered from the same admin-editable knowledge base the AI assistant answers from. */
export default async function PolicyPage({ params }: Props) {
  const { slug } = await params;
  if (!PAGES[slug]) notFound();
  const doc = await getKnowledgeDoc(slug);
  if (!doc) notFound();
  return (
    <>
      <PageHeader eyebrow="Policies" title={doc.title}>Last updated {formatDate(doc.updatedAt)}</PageHeader>
      <div className="container-x grid gap-10 py-10 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Policies" className="h-fit lg:sticky lg:top-36">
          <ul className="flex gap-2 overflow-x-auto text-sm lg:flex-col lg:gap-0.5">
            {Object.entries(PAGES).map(([s, t]) => (
              <li key={s}>
                <Link href={`/policies/${s}`} aria-current={s === slug ? "page" : undefined} className={`block rounded-lg px-3 py-2 whitespace-nowrap ${s === slug ? "bg-card text-gold-bright" : "text-muted hover:text-ink"}`}>{t}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="prose-policy max-w-3xl whitespace-pre-line">{doc.content}</article>
      </div>
    </>
  );
}
