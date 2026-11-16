import { ProductGridSkeleton } from "@/components/store/product-card";

export default function Loading() {
  return (
    <div className="container-x py-10" aria-busy="true" aria-label="Loading products">
      <div className="skeleton mb-3 h-8 w-64" />
      <div className="skeleton mb-8 h-4 w-28" />
      <div className="grid gap-8 lg:grid-cols-[16.5rem_1fr]">
        <div className="skeleton hidden h-96 lg:block" />
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
