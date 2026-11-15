import { ArrowRight, BatteryCharging, Building2, Camera, CircuitBoard, Cpu, Headphones, PackageCheck, Plug, RefreshCcw, ShieldCheck, Smartphone, Sparkles, SquareStack, ToggleLeft, Truck, Volume2, Wrench } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ComponentType } from "react";
import { OpenChatButton } from "@/components/store/chat-widget";
import { ProductGrid } from "@/components/store/product-card";
import { Stars } from "@/components/ui/bits";
import { getViewer } from "@/lib/viewer";
import { latestReviews } from "@/services/account";
import { listCategoryRecords, searchProducts, type ProductCardView } from "@/services/catalog";
import { getSetting } from "@/services/settings";

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  screens: Smartphone, batteries: BatteryCharging, "charging-ports": Plug, "button-flex": ToggleLeft, cameras: Camera, audio: Volume2, components: Cpu, housing: SquareStack, "screen-protectors": ShieldCheck, accessories: Headphones, tools: Wrench,
};

function Section({ eyebrow, title, href, children }: { eyebrow: string; title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="container-x mt-14 sm:mt-20">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1.5">{eyebrow}</p>
          <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
        </div>
        {href ? (
          <Link href={href} className="link inline-flex shrink-0 items-center gap-1 text-sm">
            View all <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default async function HomePage() {
  const { pricing, user } = await getViewer();
  const list = (input: Parameters<typeof searchProducts>[0]) => searchProducts({ pageSize: 4, ...input }, pricing).then((r) => r.items);
  const [categories, featured, best, fresh, offers, reviews, store] = await Promise.all([
    listCategoryRecords(), list({ featured: true, sort: "popular", pageSize: 8 }), list({ sort: "popular" }), list({ sort: "newest" }), list({ onSale: true, sort: "popular" }), latestReviews(3), getSetting("store"),
  ]);
  const hero: ProductCardView[] = featured.filter((p) => p.imageUrl).slice(0, 3);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: store.name,
    slogan: store.tagline,
    parentOrganization: { "@type": "Organization", name: "KodexTeck" },
    contactPoint: { "@type": "ContactPoint", telephone: store.supportPhone, email: store.supportEmail, contactType: "customer service", areaServed: "NG" },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_85%_10%,rgb(214_166_76/0.16),transparent_60%),radial-gradient(40%_60%_at_0%_100%,rgb(214_166_76/0.07),transparent_60%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(70%_70%_at_70%_30%,#000,transparent)]" />
        <div className="container-x relative grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div className="animate-fade-up">
            <p className="eyebrow mb-4 inline-flex items-center gap-2">
              <span className="h-px w-8 bg-gold" aria-hidden /> A KodexTeck Company
            </p>
            <h1 className="text-[2.6rem] leading-[1.02] font-semibold sm:text-6xl lg:text-7xl">
              Built for <span className="text-gold-gradient">Performance.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">Tested replacement parts and electronic components for the phones Nigeria runs on. Matched to your exact model, backed by warranty, delivered nationwide.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/products" className="btn btn-gold btn-lg">
                Shop parts <ArrowRight className="size-4" aria-hidden />
              </Link>
              <OpenChatButton className="btn btn-outline btn-lg" text="">
                <Sparkles className="size-4 text-gold" aria-hidden /> Find my part with AI
              </OpenChatButton>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-6 text-sm">
              {[
                ["Model-matched", "Compatibility checked per device"],
                ["Warranty", "On every eligible part"],
                ["Nationwide", "Delivery to all 36 states + FCT"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-semibold text-gold-bright">{k}</dt>
                  <dd className="mt-1 text-xs leading-snug text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {hero.length ? (
            <div className="relative mx-auto hidden aspect-[5/4] w-full max-w-xl sm:block" aria-hidden>
              <div className="absolute inset-[12%] rounded-full bg-gold/15 blur-3xl" />
              {hero.map((p, i) => (
                <div
                  key={p.id}
                  className={[
                    "absolute overflow-hidden rounded-2xl border border-line bg-card shadow-2xl shadow-black/70",
                    i === 0 ? "top-[6%] left-[22%] z-20 w-[52%] rotate-[-3deg]" : i === 1 ? "top-[34%] left-0 z-10 w-[38%] rotate-[5deg]" : "right-0 bottom-[2%] z-30 w-[40%] rotate-[4deg]",
                  ].join(" ")}
                >
                  <div className="relative aspect-square">
                    <Image src={p.imageUrl!} alt="" fill sizes="(max-width: 1024px) 40vw, 300px" priority={i === 0} className="object-cover" />
                  </div>
                  <div className="border-t border-line px-3 py-2">
                    <p className="truncate text-[0.7rem] text-muted">{p.name}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* Trust */}
      <section className="border-b border-line bg-surface" aria-label="Why shop with AUREX">
        <ul className="container-x grid grid-cols-2 gap-x-4 gap-y-5 py-6 text-sm lg:grid-cols-4">
          {[
            [PackageCheck, "Tested before dispatch", "Every part is quality-checked"],
            [ShieldCheck, "Warranty included", "Clear cover on eligible parts"],
            [Truck, "Fast delivery", "Lagos 1–2 days · nationwide"],
            [RefreshCcw, "Easy returns", "Simple, fair return policy"],
          ].map(([Icon, title, sub]) => {
            const I = Icon as ComponentType<{ className?: string }>;
            return (
              <li key={title as string} className="flex items-start gap-3">
                <I className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
                <span>
                  <span className="block font-medium">{title as string}</span>
                  <span className="block text-xs text-muted">{sub as string}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <Section eyebrow="Browse" title="Shop by category" href="/products">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {categories.slice(0, 12).map((c) => {
            const Icon = ICONS[c.slug] ?? CircuitBoard;
            return (
              <li key={c.id}>
                <Link href={`/products?category=${c.slug}`} className="card group flex h-full flex-col items-start gap-3 p-4 transition-colors hover:border-gold/60">
                  <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-gold transition-colors group-hover:border-gold/60">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-sm leading-snug font-medium group-hover:text-gold-bright">{c.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      {featured.length ? (
        <Section eyebrow="Hand-picked" title="Featured parts" href="/products?featured=1">
          <ProductGrid products={featured} priorityCount={2} />
        </Section>
      ) : null}

      {/* AI assistant entry */}
      <section className="container-x mt-14 sm:mt-20">
        <div className="relative overflow-hidden rounded-2xl border border-gold/30 bg-card p-6 sm:p-10">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-gold/15 blur-3xl" />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="eyebrow mb-2 inline-flex items-center gap-2">
                <Sparkles className="size-3.5" aria-hidden /> AUREX Assistant
              </p>
              <h2 className="text-2xl font-semibold sm:text-3xl">Not sure which part fits? Just ask.</h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">Tell the assistant your phone model and what is broken. It checks live stock and prices, confirms compatibility, builds your cart and can place the order for you — you only pay on the secure payment page.</p>
              <OpenChatButton className="btn btn-gold btn-lg mt-6">
                <Sparkles className="size-4" aria-hidden /> Start a conversation
              </OpenChatButton>
            </div>
            <ul className="grid gap-2.5">
              {["I need a screen for Samsung A15", "Do you have a battery for iPhone XR?", "How much is delivery to Abuja?"].map((q) => (
                <li key={q}>
                  <OpenChatButton text={q} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-left text-sm text-[#dcdcdc] transition-colors hover:border-gold/60 hover:text-gold-bright">
                    <span>“{q}”</span>
                    <ArrowRight className="size-4 shrink-0 text-gold" aria-hidden />
                  </OpenChatButton>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {best.length ? (
        <Section eyebrow="Most ordered" title="Best sellers" href="/products?sort=popular">
          <ProductGrid products={best} />
        </Section>
      ) : null}
      {fresh.length ? (
        <Section eyebrow="Just in" title="New arrivals" href="/products?sort=newest">
          <ProductGrid products={fresh} />
        </Section>
      ) : null}
      {offers.length ? (
        <Section eyebrow="Limited time" title="Special offers" href="/products?sale=1">
          <ProductGrid products={offers} />
        </Section>
      ) : null}

      {/* Wholesale */}
      <section className="mt-14 border-y border-line bg-surface sm:mt-20">
        <div className="container-x grid items-center gap-8 py-12 lg:grid-cols-2 lg:py-16">
          <div>
            <p className="eyebrow mb-2 inline-flex items-center gap-2">
              <Building2 className="size-3.5" aria-hidden /> For repair shops & resellers
            </p>
            <h2 className="text-2xl font-semibold sm:text-3xl">Wholesale pricing for the trade</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">Approved business accounts unlock wholesale prices, bulk-quantity discounts and a dedicated order history. Apply once — pricing switches on automatically when you sign in.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={user?.wholesaleApproved ? "/account/wholesale" : "/wholesale"} className="btn btn-gold">
                {user?.wholesaleApproved ? "Open wholesale dashboard" : "Apply for wholesale"}
              </Link>
              <Link href="/policies/wholesale-policy" className="btn btn-outline">
                How it works
              </Link>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {[
              ["Trade prices", "Lower unit prices from the minimum order quantity."],
              ["Bulk tiers", "Extra discounts as your quantities grow."],
              ["Priority support", "A team that understands repair businesses."],
            ].map(([t, d]) => (
              <li key={t} className="card p-4">
                <p className="font-medium text-gold-bright">{t}</p>
                <p className="mt-1.5 text-sm text-muted">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {reviews.length ? (
        <Section eyebrow="Reviews" title="What customers say">
          <ul className="grid gap-4 md:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="card flex flex-col p-5">
                <Stars value={r.rating} />
                {r.title ? <p className="mt-3 font-medium">{r.title}</p> : null}
                <blockquote className="mt-2 flex-1 text-sm leading-relaxed text-muted">“{r.body}”</blockquote>
                <p className="mt-4 text-xs text-faint">
                  {r.authorName}
                  {r.isVerifiedPurchase ? " · Verified purchase" : ""} ·{" "}
                  <Link href={`/products/${r.slug}`} className="hover:text-gold-bright">
                    {r.product}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
