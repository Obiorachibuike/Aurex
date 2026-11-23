import { Check, Globe, RefreshCcw, ShieldCheck, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { submitReviewAction } from "@/actions/account";
import { OpenChatButton } from "@/components/store/chat-widget";
import { ProductGrid } from "@/components/store/product-card";
import { Gallery, PurchasePanel } from "@/components/store/purchase-panel";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Stars } from "@/components/ui/bits";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/utils";
import { getViewer } from "@/lib/viewer";
import { wishlistProductIds } from "@/services/account";
import { getProductDetail, getProductReviews, getRelatedProducts } from "@/services/catalog";
import { getSetting } from "@/services/settings";
import { RETAIL_CONTEXT } from "@/services/pricing";

type Props = { params: Promise<{ slug: string }> };

// Metadata and structured data always describe the public retail offer, never a wholesale price.
const publicProduct = cache((slug: string) => getProductDetail({ slug }, RETAIL_CONTEXT));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await publicProduct((await params).slug);
  if (!p) return { title: "Product not found", robots: { index: false } };
  const fits = p.isUniversal ? "" : p.compatibleDevices.length ? ` Fits ${p.compatibleDevices.slice(0, 3).map((d) => d.label).join(", ")}.` : "";
  const description = `${p.name}${p.qualityGrade ? ` — ${p.qualityGrade}` : ""}.${fits} ${p.warrantyMonths ? `${p.warrantyMonths}-month warranty. ` : ""}Delivery across Nigeria.`.slice(0, 160);
  return { title: p.name, description, alternates: { canonical: `/products/${p.slug}` }, openGraph: { title: p.name, description, type: "website", url: `/products/${p.slug}` } };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const { user, pricing } = await getViewer();
  const [product, pub] = await Promise.all([getProductDetail({ slug }, pricing), publicProduct(slug)]);
  if (!product || !pub) notFound();
  const [reviews, related, wishlist, store] = await Promise.all([getProductReviews(product.id), getRelatedProducts(product, pricing), user ? wishlistProductIds(user.id) : Promise.resolve([] as string[]), getSetting("store")]);

  const url = `${env.appUrl}/products/${product.slug}`;
  // WhatsApp expects an international number without +, spaces or punctuation.
  // Admins may enter either 080... or +234... in Store settings.
  const rawWhatsApp = store.whatsapp.replace(/\D/g, "");
  const whatsappNumber = rawWhatsApp.startsWith("0") ? `234${rawWhatsApp.slice(1)}` : rawWhatsApp;
  const whatsappHref = /^\d{10,15}$/.test(whatsappNumber)
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi AUREX, I’m interested in ${product.name}. Please confirm availability and compatibility. ${url}`)}`
    : null;
  const abs = (u: string) => (u.startsWith("/") ? `${env.appUrl}${u}` : u);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: pub.name,
      description: pub.description.slice(0, 500) || pub.name,
      sku: pub.variants[0]?.sku,
      image: pub.images.map((i) => abs(i.url)),
      category: pub.category.name,
      ...(pub.brand ? { brand: { "@type": "Brand", name: pub.brand } } : {}),
      ...(pub.ratingCount > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: pub.ratingAvg.toFixed(1), reviewCount: pub.ratingCount } } : {}),
      offers: { "@type": "Offer", url, priceCurrency: "NGN", price: (pub.price / 100).toFixed(2), availability: pub.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", itemCondition: "https://schema.org/NewCondition", seller: { "@type": "Organization", name: "AUREX" } },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: env.appUrl },
        { "@type": "ListItem", position: 2, name: pub.category.name, item: `${env.appUrl}/products?category=${pub.category.slug}` },
        { "@type": "ListItem", position: 3, name: pub.name, item: url },
      ],
    },
  ];
  const specs = Object.entries(product.specs);

  return (
    <div className="container-x py-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-faint">
        <Link href="/" className="hover:text-gold-bright">Home</Link> /{" "}
        <Link href={`/products?category=${product.category.slug}`} className="hover:text-gold-bright">{product.category.name}</Link> / <span className="text-muted">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.05fr] lg:gap-12">
        <Gallery images={product.images} name={product.name} />

        <div>
          <p className="eyebrow mb-2">
            {product.category.name}
            {product.brand ? ` · ${product.brand}` : ""}
          </p>
          <h1 className="text-2xl leading-tight font-semibold sm:text-[2rem]" data-testid="product-title">{product.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {product.ratingCount > 0 ? (
              <a href="#reviews" className="inline-flex items-center gap-1.5">
                <Stars value={product.ratingAvg} count={product.ratingCount} />
              </a>
            ) : null}
            {product.qualityGrade ? <span className="badge badge-gold">{product.qualityGrade}</span> : null}
            {product.warrantyMonths > 0 ? (
              <span className="badge">
                <ShieldCheck className="size-3.5 text-gold" aria-hidden /> {product.warrantyMonths}-month warranty
              </span>
            ) : null}
          </div>

          <div className="mt-6">
            <PurchasePanel productId={product.id} variants={product.variants} defaultVariantId={product.defaultVariantId} saved={wishlist.includes(product.id)} signedIn={!!user} />
          </div>

          {/* Compatibility */}
          <section className="panel mt-7 p-4 sm:p-5" aria-labelledby="compat-h" data-testid="compatibility">
            <h2 id="compat-h" className="text-sm font-semibold">Compatible models</h2>
            {product.isUniversal ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                <Globe className="size-4 text-gold" aria-hidden /> Universal — works with all phone models.
              </p>
            ) : product.compatibleDevices.length ? (
              <>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {product.compatibleDevices.map((d) => (
                    <li key={d.id}>
                      <Link href={`/products?device=${d.id}`} className="badge py-1.5 text-xs hover:border-gold/60 hover:text-gold-bright">
                        <Check className="size-3.5 text-success" aria-hidden /> {d.label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-faint">Fits only the models listed. Variants with similar names (for example 4G and 5G versions) use different parts — check your exact model in Settings → About phone.</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">Compatibility has not been listed for this item. Ask us before ordering.</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <OpenChatButton className="link text-sm" text={`Will the ${product.name} fit my phone?`}>
                Not sure it fits? Ask the assistant →
              </OpenChatButton>
              {whatsappHref ? (
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1.5 text-sm" aria-label={`Ask AUREX about ${product.name} on WhatsApp`}>
                  Ask on WhatsApp ↗
                </a>
              ) : null}
            </div>
          </section>

          <ul className="mt-5 grid gap-3 text-sm text-muted sm:grid-cols-3">
            <li className="flex items-start gap-2.5"><Truck className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /><span>Lagos in 1–2 days, nationwide delivery. <Link href="/policies/shipping" className="link">Details</Link></span></li>
            <li className="flex items-start gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /><span>{product.warrantyMonths > 0 ? `${product.warrantyMonths}-month warranty.` : "Tested before dispatch."} <Link href="/policies/warranty" className="link">Policy</Link></span></li>
            <li className="flex items-start gap-2.5"><RefreshCcw className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /><span>Fair returns. <Link href="/policies/returns" className="link">How it works</Link></span></li>
          </ul>
        </div>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="desc-h">
          <h2 id="desc-h" className="text-xl font-semibold">Description</h2>
          <div className="prose-policy mt-4 whitespace-pre-line">{product.description || "No description has been added yet."}</div>
          {product.warrantyInfo ? (
            <div className="panel mt-6 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-gold" aria-hidden /> Warranty</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{product.warrantyInfo}</p>
            </div>
          ) : null}
        </section>
        {specs.length ? (
          <section aria-labelledby="spec-h">
            <h2 id="spec-h" className="text-xl font-semibold">Specifications</h2>
            <dl className="panel mt-4 divide-y divide-line text-sm">
              {specs.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-6 px-4 py-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>

      <section id="reviews" className="mt-14 scroll-mt-40" aria-labelledby="rev-h">
        <h2 id="rev-h" className="text-xl font-semibold">
          Customer reviews {product.ratingCount > 0 ? <span className="text-base font-normal text-muted">· {product.ratingAvg.toFixed(1)} out of 5</span> : null}
        </h2>
        <div className="mt-5 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            {reviews.length ? (
              <ul className="space-y-4">
                {reviews.map((r) => (
                  <li key={r.id} className="card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Stars value={r.rating} />
                      <span className="text-xs text-faint">{formatDate(r.createdAt)}</span>
                    </div>
                    {r.title ? <p className="mt-2.5 font-medium">{r.title}</p> : null}
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{r.body}</p>
                    <p className="mt-3 text-xs text-faint">
                      {r.authorName}
                      {r.isVerifiedPurchase ? <span className="text-success"> · Verified purchase</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel p-5 text-sm text-muted">No reviews yet. Be the first to share your experience with this part.</p>
            )}
          </div>
          <div className="panel h-fit p-5">
            <h3 className="font-semibold">Write a review</h3>
            {user ? (
              <ActionForm action={submitReviewAction} resetOnSuccess className="mt-4 space-y-4">
                <input type="hidden" name="productId" value={product.id} />
                <div>
                  <label htmlFor="rating" className="label">Rating</label>
                  <select id="rating" name="rating" defaultValue="5" className="input">
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rtitle" className="label">Title (optional)</label>
                  <input id="rtitle" name="title" maxLength={100} className="input" />
                </div>
                <div>
                  <label htmlFor="rbody" className="label">Your review</label>
                  <textarea id="rbody" name="body" required minLength={10} maxLength={1500} className="input" />
                </div>
                <SubmitButton>Submit review</SubmitButton>
              </ActionForm>
            ) : (
              <p className="mt-3 text-sm text-muted">
                <Link href={`/login?next=/products/${product.slug}`} className="link">Sign in</Link> to review this product.
              </p>
            )}
          </div>
        </div>
      </section>

      {related.length ? (
        <section className="mt-14" aria-labelledby="rel-h">
          <h2 id="rel-h" className="mb-5 text-xl font-semibold">Related products</h2>
          <ProductGrid products={related} />
        </section>
      ) : null}
    </div>
  );
}
