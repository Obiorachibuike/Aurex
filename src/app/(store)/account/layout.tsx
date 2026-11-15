import type { Metadata } from "next";
import { logoutAction, resendVerificationAction } from "@/actions/auth";
import { NavLinks } from "@/components/store/account-nav";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: { default: "My account", template: "%s | AUREX" }, robots: { index: false } };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/account");
  const links: [string, string][] = [["/account", "Profile"], ["/account/orders", "Orders"], ["/account/addresses", "Addresses"], ["/account/wishlist", "Wishlist"], ["/account/wholesale", "Wholesale"], ["/account/security", "Security"]];
  return (
    <div className="container-x py-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1.5">My account</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Hello, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted">{user.email}{user.wholesaleApproved ? <span className="badge badge-gold ml-2">Wholesale account</span> : null}</p>
        </div>
        <form action={logoutAction}><button type="submit" className="btn btn-outline btn-sm">Sign out</button></form>
      </div>
      {!user.emailVerified ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="text-[#f6d7a5]">Please verify your email address — we sent a link to {user.email}.</p>
          <ActionForm action={async () => { "use server"; return resendVerificationAction(); }}><SubmitButton className="btn-outline btn-sm">Resend email</SubmitButton></ActionForm>
        </div>
      ) : null}
      <div className="mt-8 grid gap-8 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Account" className="h-fit lg:sticky lg:top-36">
          <NavLinks links={links} className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col" />
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
