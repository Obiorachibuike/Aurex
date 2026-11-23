import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/actions/auth";
import { NavLinks } from "@/components/store/account-nav";
import { Logo } from "@/components/ui/bits";
import type { PermissionKey } from "@/lib/auth/permissions";
import { hasPermission } from "@/services/auth";
import { requireStaffPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: { default: "Admin", template: "%s | AUREX Admin" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NAV: [string, string, PermissionKey][] = [
  ["/admin", "Overview", "admin.access"],
  ["/admin/orders", "Orders", "orders.view"],
  ["/admin/payments", "Payments & refunds", "payments.manage"],
  ["/admin/products", "Products", "products.manage"],
  ["/admin/catalog", "Categories & devices", "products.manage"],
  ["/admin/inventory", "Inventory", "inventory.manage"],
  ["/admin/suppliers", "Suppliers & POs", "inventory.manage"],
  ["/admin/customers", "Customers", "customers.view"],
  ["/admin/wholesale", "Wholesale", "customers.manage"],
  ["/admin/marketing", "Marketing", "marketing.manage"],
  ["/admin/shipping", "Delivery", "settings.manage"],
  ["/admin/support", "Support", "support.manage"],
  ["/admin/ai", "AI assistant", "ai.manage"],
  ["/admin/staff", "Staff & roles", "staff.manage"],
  ["/admin/settings", "Settings", "settings.manage"],
  ["/admin/audit", "Audit log", "audit.view"],
];

/** Every admin page is server-rendered behind this guard; non-staff receive a 404, and each page re-checks its own permission. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage();
  const links = NAV.filter(([, , p]) => hasPermission(user, p)).map(([h, l]) => [h, l] as [string, string]);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <Logo compact />
          <span className="badge badge-gold">Admin</span>
        </div>
        <nav aria-label="Admin" className="px-2 pb-3">
          <NavLinks links={links} className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5" />
        </nav>
        <div className="hidden border-t border-line p-4 text-sm lg:block">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-xs text-faint">{user.roleName}</p>
          <div className="mt-3 flex gap-2">
            <Link href="/" className="btn btn-outline btn-sm flex-1"><ExternalLink className="size-3.5" aria-hidden /> Store</Link>
            <form action={logoutAction} className="flex-1"><button className="btn btn-ghost btn-sm w-full">Sign out</button></form>
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
