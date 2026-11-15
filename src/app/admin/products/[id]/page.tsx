import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { productStatusAction } from "@/actions/admin";
import { AdminHeader } from "@/components/admin/bits";
import { ProductForm, type ProductFormValue } from "@/components/admin/product-form";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requireStaffPage } from "@/lib/auth/session";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { getProductForEdit, listTaxonomy } from "@/services/admin-catalog";

export const metadata: Metadata = { title: "Edit product" };
const naira = (kobo: number | null) => (kobo == null ? "" : String(kobo / 100));

export default async function EditProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requireStaffPage("products.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [p, t, sp] = await Promise.all([getProductForEdit(id), listTaxonomy(), searchParams]);
  if (!p) notFound();
  const initial: ProductFormValue = {
    name: p.name, description: p.description, categoryId: p.categoryId, brandId: p.brandId ?? "", qualityGrade: p.qualityGrade ?? "", warrantyMonths: String(p.warrantyMonths), warrantyInfo: p.warrantyInfo ?? "",
    status: p.status, isFeatured: p.isFeatured, isUniversal: p.isUniversal,
    specs: Object.entries((p.specs ?? {}) as Record<string, string>).map(([key, value]) => ({ key, value })),
    images: p.images.map((i) => ({ url: i.url, alt: i.alt ?? "", publicId: i.publicId })),
    deviceIds: p.compatibility.map((c) => c.deviceModelId),
    variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, name: v.name, retailPrice: naira(v.retailPrice), compareAtPrice: naira(v.compareAtPrice), wholesalePrice: naira(v.wholesalePrice), minWholesaleQty: String(v.minWholesaleQty), stock: String(v.inventory?.onHand ?? 0), lowStockThreshold: String(v.inventory?.lowStockThreshold ?? 5) })),
  };
  return (
    <>
      <AdminHeader
        title={p.name}
        description={<>Status: {p.status.toLowerCase()} · <Link href={`/products/${p.slug}`} className="link" target="_blank">View in store</Link> · <Link href={`/admin/inventory?q=${encodeURIComponent(p.variants[0]?.sku ?? "")}`} className="link">Adjust stock</Link></>}
        actions={
          <>
            <Link href="/admin/products" className="btn btn-outline">Back</Link>
            <ActionForm action={productStatusAction}><input type="hidden" name="id" value={p.id} /><SubmitButton name="status" value="DELETE" className="btn-danger" confirm="Delete this product? Past orders keep their records.">Delete</SubmitButton></ActionForm>
          </>
        }
      />
      {sp.created ? <p role="status" data-testid="product-created" className="mb-5 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-[#b5efd2]">Product created.{p.status !== "ACTIVE" ? " It is still a draft — set the status to Active to put it on sale." : ""}</p> : null}
      <ProductForm productId={p.id} initial={initial} categories={t.categories} brands={t.brands} devices={t.devices} uploadsEnabled={cloudinaryConfigured()} />
    </>
  );
}
