"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLinks({ links, className, exactFirst = true }: { links: [string, string][]; className?: string; exactFirst?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className={className}>
      {links.map(([href, label], i) => {
        const active = i === 0 && exactFirst ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link href={href} aria-current={active ? "page" : undefined} className={cn("block rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors", active ? "bg-card font-medium text-gold-bright" : "text-muted hover:bg-card/60 hover:text-ink")}>
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
