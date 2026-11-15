import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeader } from "@/components/admin/bits";
import { EMPTY_PRODUCT, ProductForm } from "@/components/admin/product-form";
import { requireStaffPage } from "@/lib/auth/session";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { listTaxonomy } from "@/services/admin-catalog";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProduct() {
  await requireStaffPage("products.manage");
  const t = await listTaxonomy();
  return (
    <>
      <AdminHeader title="Add product" actions={<Link href="/admin/products" className="btn btn-outline">Cancel</Link>} />
      <ProductForm initial={EMPTY_PRODUCT} categories={t.categories.filter((c) => c.isActive)} brands={t.brands.filter((b) => b.isActive)} devices={t.devices.filter((d) => d.isActive)} uploadsEnabled={cloudinaryConfigured()} />
    </>
  );
}
