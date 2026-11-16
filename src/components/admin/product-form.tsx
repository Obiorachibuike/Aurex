"use client";

import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { useActionState, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveProductAction } from "@/actions/admin";
import { cn } from "@/lib/utils";

type Opt = { id: string; name: string };
type Device = { id: string; name: string; brand: string };
export type VariantForm = { id?: string; sku: string; name: string; retailPrice: string; compareAtPrice: string; wholesalePrice: string; minWholesaleQty: string; stock: string; lowStockThreshold: string };
export type ProductFormValue = {
  name: string; description: string; categoryId: string; brandId: string; qualityGrade: string; warrantyMonths: string; warrantyInfo: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED"; isFeatured: boolean; isUniversal: boolean;
  specs: { key: string; value: string }[]; images: { url: string; alt: string; publicId?: string | null }[]; deviceIds: string[]; variants: VariantForm[];
};

export const EMPTY_VARIANT: VariantForm = { sku: "", name: "Standard", retailPrice: "", compareAtPrice: "", wholesalePrice: "", minWholesaleQty: "1", stock: "0", lowStockThreshold: "5" };
export const EMPTY_PRODUCT: ProductFormValue = { name: "", description: "", categoryId: "", brandId: "", qualityGrade: "", warrantyMonths: "0", warrantyInfo: "", status: "DRAFT", isFeatured: false, isUniversal: false, specs: [], images: [], deviceIds: [], variants: [EMPTY_VARIANT] };

export function ProductForm({ productId, initial, categories, brands, devices, uploadsEnabled }: { productId?: string; initial: ProductFormValue; categories: Opt[]; brands: Opt[]; devices: Device[]; uploadsEnabled: boolean }) {
  const [v, setV] = useState(initial);
  const [state, formAction, pending] = useActionState(saveProductAction, null);
  const [uploading, startUpload] = useTransition();
  const [deviceFilter, setDeviceFilter] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const set = <K extends keyof ProductFormValue>(k: K, val: ProductFormValue[K]) => setV((p) => ({ ...p, [k]: val }));
  const setVariant = (i: number, patch: Partial<VariantForm>) => setV((p) => ({ ...p, variants: p.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const payload = useMemo(
    () =>
      JSON.stringify({
        name: v.name, description: v.description, categoryId: v.categoryId, brandId: v.brandId || null, qualityGrade: v.qualityGrade || null,
        warrantyMonths: Number(v.warrantyMonths) || 0, warrantyInfo: v.warrantyInfo || null, status: v.status, isFeatured: v.isFeatured, isUniversal: v.isUniversal,
        specs: Object.fromEntries(v.specs.filter((s) => s.key.trim()).map((s) => [s.key.trim(), s.value])),
        images: v.images.map((i) => ({ url: i.url, alt: i.alt || null, publicId: i.publicId ?? null })),
        deviceIds: v.isUniversal ? [] : v.deviceIds, variants: v.variants,
      }),
    [v],
  );

  const shownDevices = useMemo(() => {
    const f = deviceFilter.trim().toLowerCase();
    return f ? devices.filter((d) => `${d.brand} ${d.name}`.toLowerCase().includes(f)) : devices;
  }, [devices, deviceFilter]);

  function upload(files: FileList | null) {
    if (!files?.length) return;
    startUpload(async () => {
      for (const file of Array.from(files).slice(0, 12 - v.images.length)) {
        const fd = new FormData();
        fd.set("file", file);
        try {
          const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
          const data = (await res.json()) as { url?: string; publicId?: string; error?: string };
          if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
          setV((p) => ({ ...p, images: [...p.images, { url: data.url!, alt: p.name, publicId: data.publicId }] }));
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Upload failed");
        }
      }
    });
  }
  const addUrl = () => {
    const u = imageUrl.trim();
    if (!u) return;
    if (!/^(https:\/\/|\/)/.test(u)) return void toast.error("Use an https:// image address.");
    set("images", [...v.images, { url: u, alt: v.name }]);
    setImageUrl("");
  };
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-6" data-testid="product-form">
      {productId ? <input type="hidden" name="id" value={productId} /> : null}
      <input type="hidden" name="payload" value={payload} />
      {state && !state.ok ? (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-[#ffc9c3]">
          <p>{state.error}</p>
          {fe ? <ul className="mt-1.5 list-disc pl-5">{Object.entries(fe).map(([k, m]) => (<li key={k}>{m}</li>))}</ul> : null}
        </div>
      ) : null}
      {state?.ok ? <p role="status" className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-[#b5efd2]">{state.message}</p> : null}

      <fieldset className="panel space-y-4 p-5">
        <legend className="sr-only">Basics</legend>
        <h2 className="font-semibold">Basics</h2>
        <div><label htmlFor="p-name" className="label">Product name</label><input id="p-name" required maxLength={160} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Samsung Galaxy A15 4G Display Assembly" className="input" /></div>
        <div><label htmlFor="p-desc" className="label">Description</label><textarea id="p-desc" rows={5} maxLength={8000} value={v.description} onChange={(e) => set("description", e.target.value)} className="input" /></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label htmlFor="p-cat" className="label">Category</label><select id="p-cat" required value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)} className="input"><option value="">Select…</option>{categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></div>
          <div><label htmlFor="p-brand" className="label">Brand</label><select id="p-brand" value={v.brandId} onChange={(e) => set("brandId", e.target.value)} className="input"><option value="">None / generic</option>{brands.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></div>
          <div><label htmlFor="p-grade" className="label">Quality grade</label><input id="p-grade" list="grades" value={v.qualityGrade} onChange={(e) => set("qualityGrade", e.target.value)} placeholder="e.g. Service Pack" className="input" /><datalist id="grades">{["Original", "Service Pack", "OEM", "High Copy", "Refurbished"].map((g) => (<option key={g} value={g} />))}</datalist></div>
          <div><label htmlFor="p-wm" className="label">Warranty (months)</label><input id="p-wm" type="number" min={0} max={120} value={v.warrantyMonths} onChange={(e) => set("warrantyMonths", e.target.value)} className="input" /></div>
          <div className="sm:col-span-2"><label htmlFor="p-wi" className="label">Warranty details (optional)</label><input id="p-wi" maxLength={1000} value={v.warrantyInfo} onChange={(e) => set("warrantyInfo", e.target.value)} className="input" /></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div><label htmlFor="p-status" className="label">Status</label><select id="p-status" value={v.status} onChange={(e) => set("status", e.target.value as ProductFormValue["status"])} className="input w-auto"><option value="DRAFT">Draft (hidden)</option><option value="ACTIVE">Active (on sale)</option><option value="ARCHIVED">Archived</option></select></div>
          <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" className="check" checked={v.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} /> Feature on the home page</label>
        </div>
      </fieldset>

      <fieldset className="panel p-5">
        <legend className="sr-only">Variants, prices and stock</legend>
        <h2 className="font-semibold">Variants, prices & stock</h2>
        <p className="mt-1 text-sm text-muted">Prices are in naira. Leave wholesale empty if the item has no trade price.</p>
        <div className="mt-4 space-y-4">
          {v.variants.map((x, i) => (
            <div key={i} className="rounded-xl border border-line bg-card/40 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div><label className="label" htmlFor={`v-sku-${i}`}>SKU</label><input id={`v-sku-${i}`} required value={x.sku} onChange={(e) => setVariant(i, { sku: e.target.value.toUpperCase() })} placeholder="AUR-SCR-…" className="input font-mono" /></div>
                <div><label className="label" htmlFor={`v-name-${i}`}>Variant name</label><input id={`v-name-${i}`} value={x.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder="Standard, Black, With frame…" className="input" /></div>
                <div><label className="label" htmlFor={`v-rp-${i}`}>Retail price (₦)</label><input id={`v-rp-${i}`} required inputMode="decimal" value={x.retailPrice} onChange={(e) => setVariant(i, { retailPrice: e.target.value })} className="input" /></div>
                <div><label className="label" htmlFor={`v-cp-${i}`}>“Was” price (₦, optional)</label><input id={`v-cp-${i}`} inputMode="decimal" value={x.compareAtPrice} onChange={(e) => setVariant(i, { compareAtPrice: e.target.value })} className="input" /></div>
                <div><label className="label" htmlFor={`v-wp-${i}`}>Wholesale price (₦)</label><input id={`v-wp-${i}`} inputMode="decimal" value={x.wholesalePrice} onChange={(e) => setVariant(i, { wholesalePrice: e.target.value })} className="input" /></div>
                <div><label className="label" htmlFor={`v-moq-${i}`}>Min. wholesale qty</label><input id={`v-moq-${i}`} type="number" min={1} value={x.minWholesaleQty} onChange={(e) => setVariant(i, { minWholesaleQty: e.target.value })} className="input" /></div>
                <div>
                  <label className="label" htmlFor={`v-st-${i}`}>{x.id ? "Stock on hand" : "Opening stock"}</label>
                  <input id={`v-st-${i}`} type="number" min={0} value={x.stock} disabled={!!x.id} onChange={(e) => setVariant(i, { stock: e.target.value })} className="input disabled:opacity-60" />
                  {x.id ? <p className="hint">Change stock from Inventory so every movement is logged.</p> : null}
                </div>
                <div><label className="label" htmlFor={`v-lt-${i}`}>Low-stock alert at</label><input id={`v-lt-${i}`} type="number" min={0} value={x.lowStockThreshold} onChange={(e) => setVariant(i, { lowStockThreshold: e.target.value })} className="input" /></div>
              </div>
              {v.variants.length > 1 ? <button type="button" onClick={() => set("variants", v.variants.filter((_, j) => j !== i))} className="btn btn-ghost btn-sm mt-3 text-danger"><Trash2 className="size-3.5" aria-hidden /> Remove variant</button> : null}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set("variants", [...v.variants, { ...EMPTY_VARIANT, name: "" }])} className="btn btn-outline btn-sm mt-4"><Plus className="size-4" aria-hidden /> Add variant</button>
      </fieldset>

      <fieldset className="panel p-5">
        <legend className="sr-only">Images</legend>
        <h2 className="font-semibold">Images</h2>
        <p className="mt-1 text-sm text-muted">Up to 12. The first image is the main one.</p>
        {v.images.length ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {v.images.map((img, i) => (
              <li key={img.url + i} className="rounded-lg border border-line bg-card p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of arbitrary https sources */}
                <img src={img.url} alt={img.alt} className="aspect-square w-full rounded object-cover" />
                <input aria-label="Alt text" value={img.alt} onChange={(e) => set("images", v.images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} placeholder="Alt text" className="input mt-2 px-2 py-1 text-xs" />
                <div className="mt-1.5 flex justify-between text-xs">
                  {i > 0 ? <button type="button" className="link" onClick={() => set("images", [img, ...v.images.filter((_, j) => j !== i)])}>Make main</button> : <span className="text-gold">Main</span>}
                  <button type="button" className="text-danger" onClick={() => set("images", v.images.filter((_, j) => j !== i))}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {uploadsEnabled ? (
            <label className={cn("btn btn-outline cursor-pointer", uploading && "pointer-events-none opacity-60")}>
              {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />} Upload images
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </label>
          ) : <p className="text-xs text-muted">Uploads need Cloudinary keys (see README). Until then, paste an image address:</p>}
          <div className="flex min-w-64 flex-1 gap-2"><input aria-label="Image address" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }} placeholder="https://… or /demo/screen.jpg" className="input" /><button type="button" onClick={addUrl} className="btn btn-outline">Add</button></div>
        </div>
      </fieldset>

      <fieldset className="panel p-5">
        <legend className="sr-only">Compatibility</legend>
        <h2 className="font-semibold">Compatible devices</h2>
        <p className="mt-1 text-sm text-muted">Customers and the AI assistant rely on this to avoid wrong-part orders. Tick only the exact models this part fits.</p>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" className="check" checked={v.isUniversal} onChange={(e) => set("isUniversal", e.target.checked)} /> Universal — works with any phone (cables, tools, chargers)</label>
        {!v.isUniversal ? (
          <>
            <input type="search" aria-label="Filter devices" value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)} placeholder="Filter devices…" className="input mt-4 max-w-sm" />
            <div className="mt-3 grid max-h-64 gap-x-4 gap-y-1.5 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-3">
              {shownDevices.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="check" checked={v.deviceIds.includes(d.id)} onChange={(e) => set("deviceIds", e.target.checked ? [...v.deviceIds, d.id] : v.deviceIds.filter((x) => x !== d.id))} /> {d.brand} {d.name}</label>
              ))}
              {!shownDevices.length ? <p className="text-sm text-muted">No device matches. Add it under Categories & devices first.</p> : null}
            </div>
            <p className="hint">{v.deviceIds.length} selected</p>
          </>
        ) : null}
      </fieldset>

      <fieldset className="panel p-5">
        <legend className="sr-only">Specifications</legend>
        <h2 className="font-semibold">Specifications</h2>
        <div className="mt-3 space-y-2">
          {v.specs.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label="Specification name" value={s.key} onChange={(e) => set("specs", v.specs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder="e.g. Capacity" className="input max-w-48" />
              <input aria-label="Specification value" value={s.value} onChange={(e) => set("specs", v.specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="e.g. 5000mAh" className="input" />
              <button type="button" aria-label="Remove specification" onClick={() => set("specs", v.specs.filter((_, j) => j !== i))} className="btn btn-ghost btn-icon"><Trash2 className="size-4" aria-hidden /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => set("specs", [...v.specs, { key: "", value: "" }])} className="btn btn-outline btn-sm mt-3"><Plus className="size-4" aria-hidden /> Add specification</button>
      </fieldset>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <button type="submit" disabled={pending || uploading} className="btn btn-gold" data-testid="save-product">{pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{productId ? "Save changes" : "Create product"}</button>
      </div>
    </form>
  );
}
