"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/ui/bits";

export function MobileMenu({ categories, signedIn, isStaff }: { categories: { name: string; slug: string }[]; signedIn: boolean; isStaff: boolean }) {
  const [open, setOpen] = useState(false);
  const link = "block rounded-lg px-3 py-3 text-[0.95rem] text-[#e4e4e4] hover:bg-raised";
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="btn btn-ghost btn-icon lg:hidden" aria-label="Open menu">
        <Menu className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm" />
        <Dialog.Content onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }} className="fixed inset-y-0 left-0 z-[61] flex w-[86vw] max-w-sm flex-col border-r border-line bg-surface shadow-2xl outline-none">
          <div className="flex items-center justify-between border-b border-line px-4 py-4">
            <Dialog.Title asChild>
              <span>
                <Logo />
              </span>
            </Dialog.Title>
            <Dialog.Description className="sr-only">Site navigation</Dialog.Description>
            <Dialog.Close className="btn btn-ghost btn-icon" aria-label="Close menu">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <nav className="flex-1 overflow-y-auto p-3" aria-label="Mobile">
            <p className="eyebrow px-3 pt-2 pb-1">Shop</p>
            <Link href="/products" className={link} onClick={() => setOpen(false)}>
              All products
            </Link>
            {categories.map((c) => (
              <Link key={c.slug} href={`/products?category=${c.slug}`} className={link} onClick={() => setOpen(false)}>
                {c.name}
              </Link>
            ))}
            <p className="eyebrow px-3 pt-5 pb-1">AUREX</p>
            {[
              ["/wholesale", "Wholesale"],
              ["/track", "Track an order"],
              ["/about", "About us"],
              ["/faq", "FAQ"],
              ["/contact", "Contact"],
            ].map(([href, label]) => (
              <Link key={href} href={href!} className={link} onClick={() => setOpen(false)}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="grid gap-2 border-t border-line p-4">
            {isStaff ? (
              <Link href="/admin" className="btn btn-outline" onClick={() => setOpen(false)}>
                Admin dashboard
              </Link>
            ) : null}
            <Link href={signedIn ? "/account" : "/login"} className="btn btn-gold" onClick={() => setOpen(false)}>
              {signedIn ? "My account" : "Sign in / Register"}
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
