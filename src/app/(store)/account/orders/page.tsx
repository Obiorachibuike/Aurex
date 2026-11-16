import { Package } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ProductImage, StatusBadge } from "@/components/ui/bits";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { listOrdersForUser } from "@/services/orders";

export const metadata: Metadata = { title: "My orders" };

export default async function OrdersPage() {
  const user = await requireUser("/account/orders");
  const orders = await listOrdersForUser(user.id);
  if (!orders.length) return <EmptyState icon={<Package className="size-5" />} title="No orders yet" action={<Link href="/products" className="btn btn-gold">Shop parts</Link>}>When you place an order it will appear here with live tracking.</EmptyState>;
  return (
    <ul className="space-y-3">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/orders/${o.number}`} className="card flex flex-wrap items-center gap-4 p-4 transition-colors hover:border-gold/50">
            <span className="flex -space-x-3">
              {o.items.slice(0, 3).map((it, i) => (
                <span key={i} className="relative size-12 overflow-hidden rounded-lg border-2 border-card bg-surface"><ProductImage src={it.imageUrl} alt="" sizes="48px" /></span>
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-sm font-medium">{o.number}</span>
              <span className="block truncate text-xs text-muted">{o.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")}</span>
              <span className="block text-xs text-faint">{formatDate(o.createdAt, true)}{o.pricingTier === "WHOLESALE" ? " · Wholesale" : ""}</span>
            </span>
            <span className="flex items-center gap-3"><StatusBadge status={o.status} /><span className="font-medium tabular-nums">{formatMoney(o.total)}</span></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
