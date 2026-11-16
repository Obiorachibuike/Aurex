import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn, formatMoney } from "@/lib/utils";

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className="text-gold-gradient text-[1.45rem] font-extrabold tracking-[0.32em]">AUREX</span>
      {compact ? null : <span className="mt-1 text-[0.5rem] font-medium tracking-[0.34em] text-muted uppercase">A KodexTeck Company</span>}
    </span>
  );
}

const OPTIMISABLE = /^\/|^https:\/\/res\.cloudinary\.com\//;

/** Product imagery: optimised through next/image when the host is known, otherwise a lazy native image. */
export function ProductImage({ src, alt, sizes, priority, className }: { src: string | null | undefined; alt: string; sizes?: string; priority?: boolean; className?: string }) {
  if (!src) {
    return (
      <div className={cn("flex size-full items-center justify-center bg-surface text-[0.65rem] tracking-[0.3em] text-faint", className)} role="img" aria-label={alt}>
        AUREX
      </div>
    );
  }
  if (OPTIMISABLE.test(src)) return <Image src={src} alt={alt} fill sizes={sizes ?? "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"} priority={priority} className={cn("object-cover", className)} />;
  // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-supplied hosts cannot go through the optimiser
  return <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" className={cn("absolute inset-0 size-full object-cover", className)} />;
}

export function Price({ amount, compareAt, className, size = "md" }: { amount: number; compareAt?: number | null; className?: string; size?: "sm" | "md" | "lg" }) {
  const onSale = !!compareAt && compareAt > amount;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span className={cn("font-semibold text-gold-bright tabular-nums", size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-base")}>{formatMoney(amount)}</span>
      {onSale ? <span className={cn("text-faint line-through tabular-nums", size === "lg" ? "text-base" : "text-xs")}>{formatMoney(compareAt)}</span> : null}
    </span>
  );
}

export function Stars({ value, count, className }: { value: number; count?: number; className?: string }) {
  const rounded = Math.round(value);
  return (
    <span className={cn("inline-flex items-center gap-1", className)} role="img" aria-label={`Rated ${value.toFixed(1)} out of 5${count !== undefined ? ` from ${count} review${count === 1 ? "" : "s"}` : ""}`}>
      <span className="flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cn("size-3.5", i <= rounded ? "fill-gold text-gold" : "text-[#3a3a3a]")} />
        ))}
      </span>
      {count !== undefined ? <span className="text-xs text-faint">({count})</span> : null}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "badge-amber", AWAITING_PAYMENT: "badge-amber", PAID: "badge-green", PROCESSING: "badge-gold", READY_FOR_DISPATCH: "badge-gold", SHIPPED: "badge-gold", DELIVERED: "badge-green",
  CANCELLED: "badge-red", REFUND_REQUESTED: "badge-amber", REFUNDED: "", SUCCESS: "badge-green", FAILED: "badge-red", ABANDONED: "", ACTIVE: "badge-green", DRAFT: "badge-amber", ARCHIVED: "",
  APPROVED: "badge-green", REJECTED: "badge-red", NONE: "", OPEN: "badge-amber", IN_PROGRESS: "badge-gold", RESOLVED: "badge-green", ESCALATED: "badge-amber", CLOSED: "", REQUESTED: "badge-amber", PROCESSED: "badge-green",
  QUEUED: "badge-amber", SENT: "badge-green", SKIPPED: "",
};
const STATUS_LABEL: Record<string, string> = { AWAITING_PAYMENT: "Awaiting payment", READY_FOR_DISPATCH: "Ready for dispatch", REFUND_REQUESTED: "Refund requested", IN_PROGRESS: "In progress", NONE: "Retail" };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
  return <span className={cn("badge", STATUS_STYLE[status], className)}>{label}</span>;
}

export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null;
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="btn btn-outline btn-sm" rel="prev" aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </Link>
      ) : null}
      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          {i > 0 && p - pages[i - 1]! > 1 ? <span className="px-1 text-faint">…</span> : null}
          <Link href={hrefFor(p)} aria-current={p === page ? "page" : undefined} className={cn("btn btn-sm min-w-9", p === page ? "btn-gold" : "btn-outline")}>
            {p}
          </Link>
        </span>
      ))}
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className="btn btn-outline btn-sm" rel="next" aria-label="Next page">
          <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </nav>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center px-6 py-14 text-center">
      {icon ? <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-line bg-card text-gold">{icon}</div> : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? <p className="mt-2 max-w-md text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Field({ label, name, hint, children, className }: { label: string; name?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="border-b border-line bg-surface/60">
      <div className="container-x py-8 sm:py-12">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
        {children ? <div className="mt-3 max-w-2xl text-sm text-muted sm:text-base">{children}</div> : null}
      </div>
    </header>
  );
}
