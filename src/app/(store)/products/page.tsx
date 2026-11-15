import { Check, SearchX, SlidersHorizontal, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OpenChatButton } from "@/components/store/chat-widget";
import { ProductGrid } from "@/components/store/product-card";
import { EmptyState, Pagination } from "@/components/ui/bits";
import { parseMoney } from "@/lib/utils";
import { getViewer } from "@/lib/viewer";
import { getFacets, searchProducts, type ProductSearchInput } from "@/services/catalog";
import { deviceLabel } from "@/services/compatibility";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const SORTS = [["relevance", "Relevance"], ["popular", "Most popular"], ["newest", "Newest"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"]] as const;

function read(sp: SP) {
  const sort = one(sp.sort);
  const page = Number(one(sp.page));
  const device = one(sp.device);
  return {
    q: one(sp.q)?.slice(0, 100),
    category: one(sp.category),
    brand: one(sp.brand),
    device: device && /^[0-9a-f-]{36}$/i.test(device) ? device : undefined,
    min: one(sp.min),
    max: one(sp.max),
    stock: one(sp.stock) === "1",
    sale: one(sp.sale) === "1",
    featured: one(sp.featured) === "1",
    sort: SORTS.some(([k]) => k === sort) ? (sort as ProductSearchInput["sort"]) : undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
type Filters = ReturnType<typeof read>;

function href(f: Filters, patch: Partial<Record<keyof Filters, string | number | boolean | undefined>>): string {
  const merged = { ...f, page: 1, ...patch } as Record<string, unknown>;
  const p = new URLSearchParams();
  for (const k of ["q", "category", "brand", "device", "min", "max", "sort"]) if (merged[k]) p.set(k, String(merged[k]));
  for (const k of ["stock", "sale", "featured"]) if (merged[k]) p.set(k, "1");
  if (Number(merged.page) > 1) p.set("page", String(merged.page));
  const s = p.toString();
  return s ? `/products?${s}` : "/products";
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const f = read(await searchParams);
  const facets = await getFacets();
  const cat = facets.categories.find((c) => c.slug === f.category);
  const dev = facets.devices.find((d) => d.id === f.device);
  const title = f.q ? `Search: ${f.q}` : dev ? `${cat?.name ?? "Parts"} for ${dev.label}` : (cat?.name ?? "All phone parts & components");
  const canonical = cat && !f.q && !dev ? `/products?category=${cat.slug}` : "/products";
  // Filtered / searched / paginated views are not indexed; category pages are.
  const filtered = !!(f.q || f.device || f.brand || f.min || f.max || f.stock || f.sale || f.featured || f.sort || f.page > 1);
  return { title, description: `Shop ${title.toLowerCase()} at AUREX — tested parts with warranty and delivery across Nigeria.`, alternates: { canonical }, robots: filtered ? { index: false, follow: true } : undefined };
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const f = read(await searchParams);
  const { pricing } = await getViewer();
  const [facets, result] = await Promise.all([
    getFacets(),
    searchProducts({ q: f.q, categorySlug: f.category, brandSlug: f.brand, deviceId: f.device, minPrice: parseMoney(f.min) ?? undefined, maxPrice: parseMoney(f.max) ?? undefined, inStockOnly: f.stock, onSale: f.sale, featured: f.featured, sort: f.sort ?? (f.q ? "relevance" : "popular"), page: f.page, pageSize: 24 }, pricing),
  ]);

  const selectedDevice = facets.devices.find((d) => d.id === f.device);
  const resolved = result.device;
  const matchedDevice = selectedDevice?.label ?? (resolved.status === "exact" ? deviceLabel(resolved.device) : null);
  const category = facets.categories.find((c) => c.slug === f.category) ?? result.matchedCategory;
  const heading = f.q ? `Results for “${f.q}”` : selectedDevice ? `${category?.name ?? "Parts"} for ${selectedDevice.label}` : (category?.name ?? "All products");
  const chips: [string, string][] = [];
  if (f.category && category) chips.push([category.name, href(f, { category: undefined })]);
  if (f.brand) chips.push([facets.brands.find((b) => b.slug === f.brand)?.name ?? f.brand, href(f, { brand: undefined })]);
  if (selectedDevice) chips.push([selectedDevice.label, href(f, { device: undefined })]);
  if (f.min || f.max) chips.push([`₦${f.min ?? "0"} – ${f.max ? `₦${f.max}` : "any"}`, href(f, { min: undefined, max: undefined })]);
  if (f.stock) chips.push(["In stock", href(f, { stock: undefined })]);
  if (f.sale) chips.push(["On offer", href(f, { sale: undefined })]);
  if (f.featured) chips.push(["Featured", href(f, { featured: undefined })]);
  const brandsWithDevices = [...new Set(facets.devices.map((d) => d.brand))];

  const filters = (
    <form action="/products" method="get" className="space-y-6" data-testid="filters">
      {f.q ? <input type="hidden" name="q" value={f.q} /> : null}
      {f.sort ? <input type="hidden" name="sort" value={f.sort} /> : null}
      <div>
        <label htmlFor="f-device" className="label">
          Phone model
        </label>
        <select id="f-device" name="device" defaultValue={f.device ?? ""} className="input">
          <option value="">Any model</option>
          {brandsWithDevices.map((b) => (
            <optgroup key={b} label={b}>
              {facets.devices.filter((d) => d.brand === b).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-category" className="label">
          Category
        </label>
        <select id="f-category" name="category" defaultValue={f.category ?? ""} className="input">
          <option value="">All categories</option>
          {facets.categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-brand" className="label">
          Brand
        </label>
        <select id="f-brand" name="brand" defaultValue={f.brand ?? ""} className="input">
          <option value="">All brands</option>
          {facets.brands.map((b) => (
            <option key={b.slug} value={b.slug}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="label">Price (₦)</legend>
        <div className="flex items-center gap-2">
          <input name="min" inputMode="numeric" pattern="[0-9,]*" defaultValue={f.min ?? ""} placeholder="Min" aria-label="Minimum price in naira" className="input" />
          <span className="text-faint">–</span>
          <input name="max" inputMode="numeric" pattern="[0-9,]*" defaultValue={f.max ?? ""} placeholder="Max" aria-label="Maximum price in naira" className="input" />
        </div>
      </fieldset>
      <fieldset className="space-y-2.5">
        <legend className="label">Availability</legend>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" name="stock" value="1" defaultChecked={f.stock} className="check" /> In stock only
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" name="sale" value="1" defaultChecked={f.sale} className="check" /> On offer
        </label>
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-gold flex-1">
          Apply filters
        </button>
        {chips.length ? (
          <Link href={f.q ? `/products?q=${encodeURIComponent(f.q)}` : "/products"} className="btn btn-outline">
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );

  return (
    <div className="container-x py-8 sm:py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-xs text-faint">
        <Link href="/" className="hover:text-gold-bright">
          Home
        </Link>{" "}
        / <span className="text-muted">{category && !f.q ? category.name : "Products"}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{heading}</h1>
          <p className="mt-1.5 text-sm text-muted" data-testid="result-count">
            {result.total} product{result.total === 1 ? "" : "s"}
          </p>
        </div>
        <form action="/products" method="get" className="flex items-center gap-2">
          {(["q", "category", "brand", "device", "min", "max"] as const).map((k) => (f[k] ? <input key={k} type="hidden" name={k} value={f[k]} /> : null))}
          {f.stock ? <input type="hidden" name="stock" value="1" /> : null}
          {f.sale ? <input type="hidden" name="sale" value="1" /> : null}
          <label htmlFor="sort" className="text-xs text-muted">
            Sort by
          </label>
          <select id="sort" name="sort" defaultValue={f.sort ?? (f.q ? "relevance" : "popular")} className="input min-h-10 w-auto py-1.5">
            {SORTS.filter(([k]) => k !== "relevance" || f.q).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-outline btn-sm min-h-10">
            Sort
          </button>
        </form>
      </div>

      {/* Compatibility guidance from the structured device matcher */}
      {f.q && resolved.status === "exact" ? (
        <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-[#b5efd2]" data-testid="compat-exact">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Showing parts confirmed to fit the <strong>{deviceLabel(resolved.device)}</strong>
            {resolved.device.modelNumbers.length ? ` (${resolved.device.modelNumbers.join(", ")})` : ""}.
          </span>
        </p>
      ) : null}
      {f.q && resolved.status === "ambiguous" && !f.device ? (
        <div className="mt-5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-4" data-testid="compat-ambiguous" role="status">
          <p className="text-sm font-medium text-gold-bright">Which model do you have?</p>
          <p className="mt-1 text-sm text-muted">These models share a name but use different parts. Choose yours so we only show parts that fit.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {resolved.candidates.map((d) => (
              <Link key={d.id} href={href(f, { device: d.id })} className="btn btn-outline btn-sm" data-testid="device-choice">
                {deviceLabel(d)}
                {d.modelNumbers[0] ? <span className="text-faint">· {d.modelNumbers[0]}</span> : null}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {chips.length ? (
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map(([label, to]) => (
            <li key={label}>
              <Link href={to} className="badge badge-gold py-1.5 pr-2 pl-3 text-xs" aria-label={`Remove filter ${label}`}>
                {label} <X className="size-3.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 grid gap-8 lg:grid-cols-[16.5rem_1fr]">
        <aside aria-label="Filters">
          <details className="panel group lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-gold" aria-hidden /> Filters{chips.length ? ` (${chips.length})` : ""}
              </span>
              <span className="text-xs text-faint group-open:hidden">Show</span>
              <span className="hidden text-xs text-faint group-open:inline">Hide</span>
            </summary>
            <div className="border-t border-line p-4">{filters}</div>
          </details>
          <div className="panel sticky top-36 hidden p-5 lg:block">{filters}</div>
        </aside>

        <div>
          {result.items.length ? (
            <>
              <ProductGrid products={result.items} fitsDevice={matchedDevice} priorityCount={4} />
              <Pagination page={result.page} pageCount={result.pageCount} hrefFor={(p) => href(f, { page: p })} />
            </>
          ) : (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title={matchedDevice ? `No matching parts listed for the ${matchedDevice} yet` : "No products match your search"}
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <Link href="/products" className="btn btn-outline">
                    Browse all products
                  </Link>
                  <OpenChatButton className="btn btn-gold" text={f.q ? `I'm looking for ${f.q}` : undefined}>
                    Ask the assistant
                  </OpenChatButton>
                </div>
              }
            >
              {matchedDevice ? "We never substitute parts made for a different model. Try another category, or ask our assistant to check for you." : "Try a different phone model or part name, or remove some filters."}
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
