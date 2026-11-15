import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { productStatusAction } from "@/actions/admin";
import { AdminHeader, SearchForm } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Pagination, ProductImage, StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { formatMoney } from "@/lib/utils";
import { listProductsAdmin } from "@/services/admin-catalog";

export const metadata: Metadata = { title: "Products" };
const STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export default async function ProductsAdmin({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  await requireStaffPage("products.manage");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const res = await listProductsAdmin({ q: sp.q, status, page: Number(sp.page) || 1 });
  const href = (page: number) => `/admin/products?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(status ? { status } : {}), page: String(page) })}`;
  return (
    <>
      <AdminHeader title="Products" description={`${res.total} product(s)`} actions={<Link href="/admin/products/new" className="btn btn-gold" data-testid="new-product"><Plus className="size-4" aria-hidden /> Add product</Link>} />
      <SearchForm action="/admin/products" q={sp.q} placeholder="Search by name or SKU">
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className="input w-auto"><option value="">All statuses</option>{STATUSES.map((s) => (<option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>))}</select>
      </SearchForm>
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead><tr><th>Product</th><th>Status</th><th className="text-right">Retail from</th><th className="text-right">Wholesale from</th><th className="text-right">Available</th><th className="text-right">Sold</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {res.rows.map((p) => (
              <tr key={p.id} data-testid="admin-product-row">
                <td>
                  <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 hover:text-gold-bright">
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-card"><ProductImage src={p.image} alt="" sizes="40px" /></span>
                    <span className="min-w-0"><span className="block max-w-xs truncate font-medium">{p.name}</span><span className="block text-xs text-faint">{p.category} · <span className="font-mono">{p.sku}</span></span></span>
                  </Link>
                </td>
                <td><StatusBadge status={p.status} />{p.isDemo ? <span className="badge ml-1">Demo</span> : null}</td>
                <td className="text-right tabular-nums">{p.minPrice != null ? formatMoney(p.minPrice) : "—"}</td>
                <td className="text-right tabular-nums text-muted">{p.minWholesale != null ? formatMoney(p.minWholesale) : "—"}</td>
                <td className="text-right"><span className={`badge ${p.available <= 0 ? "badge-red" : ""}`}>{p.available}</span></td>
                <td className="text-right tabular-nums text-muted">{p.soldCount}</td>
                <td>
                  <ActionForm action={productStatusAction} className="flex justify-end gap-1">
                    <input type="hidden" name="id" value={p.id} />
                    {p.status !== "ACTIVE" ? <SubmitButton name="status" value="ACTIVE" className="btn-outline btn-sm">Publish</SubmitButton> : <SubmitButton name="status" value="ARCHIVED" className="btn-ghost btn-sm">Archive</SubmitButton>}
                  </ActionForm>
                </td>
              </tr>
            ))}
            {!res.rows.length ? <tr><td colSpan={7} className="py-10 text-center text-muted">No products match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="mt-5"><Pagination page={res.page} pageCount={res.pageCount} hrefFor={href} /></div>
    </>
  );
}
