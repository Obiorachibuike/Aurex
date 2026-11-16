import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/bits";
import { getKnowledgeDoc } from "@/services/ai/knowledge";
import { getSetting } from "@/services/settings";

export const metadata: Metadata = { title: "About AUREX", description: "AUREX — a KodexTeck company — supplies tested phone replacement parts and electronic components across Nigeria.", alternates: { canonical: "/about" } };

export default async function AboutPage() {
  const [doc, store] = await Promise.all([getKnowledgeDoc("about"), getSetting("store")]);
  return (
    <>
      <PageHeader eyebrow="A KodexTeck Company" title="About AUREX">{store.tagline}</PageHeader>
      <div className="container-x grid gap-10 py-10 lg:grid-cols-[1.5fr_1fr]">
        <div className="prose-policy whitespace-pre-line">{doc?.content ?? "AUREX supplies tested replacement parts and electronic components for mobile phones."}</div>
        <aside className="panel h-fit space-y-4 p-6 text-sm">
          <h2 className="eyebrow">Get in touch</h2>
          <p className="text-muted">{store.address}</p>
          <p className="text-muted">{store.businessHours}</p>
          <p><a className="link" href={`mailto:${store.supportEmail}`}>{store.supportEmail}</a><br /><span className="text-muted">{store.supportPhone}</span></p>
          <Link href="/contact" className="btn btn-gold w-full">Contact us</Link>
        </aside>
      </div>
    </>
  );
}
