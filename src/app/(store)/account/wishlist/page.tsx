import { Heart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/store/product-card";
import { EmptyState } from "@/components/ui/bits";
import { requireUser } from "@/lib/auth/session";
import { getWishlist } from "@/services/account";
import { pricingContextFor } from "@/services/pricing";

export const metadata: Metadata = { title: "My wishlist" };

export default async function WishlistPage() {
  const user = await requireUser("/account/wishlist");
  const items = await getWishlist(user.id, pricingContextFor(user));
  if (!items.length) return <EmptyState icon={<Heart className="size-5" />} title="Your wishlist is empty" action={<Link href="/products" className="btn btn-gold">Browse products</Link>}>Tap the heart on any product to save it for later.</EmptyState>;
  return <ProductGrid products={items} />;
}
