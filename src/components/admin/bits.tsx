import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AdminHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "gold" | "warn" }) {
  const body = (
    <>
      <p className="text-xs tracking-wider text-faint uppercase">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", tone === "gold" && "text-gold-bright", tone === "warn" && "text-warning")}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </>
  );
  return href ? <Link href={href} className="card block p-4 transition-colors hover:border-gold/50">{body}</Link> : <div className="card p-4">{body}</div>;
}

export function Section({ title, children, actions, className }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn("panel", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Tabs({ tabs, current }: { tabs: [string, string, number?][]; current: string }) {
  return (
    <nav className="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Views">
      {tabs.map(([href, label, count]) => (
        <Link key={href} href={href} aria-current={href === current ? "page" : undefined} className={cn("-mb-px border-b-2 px-3.5 py-2.5 text-sm whitespace-nowrap", href === current ? "border-gold font-medium text-gold-bright" : "border-transparent text-muted hover:text-ink")}>
          {label}
          {count ? <span className="ml-1.5 rounded-full bg-gold/15 px-1.5 py-0.5 text-[11px] text-gold-bright">{count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function SearchForm({ action, q, placeholder, children }: { action: string; q?: string; placeholder: string; children?: ReactNode }) {
  return (
    <form action={action} className="mb-4 flex flex-wrap gap-2">
      <input type="search" name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} className="input max-w-sm" />
      {children}
      <button className="btn btn-outline">Search</button>
    </form>
  );
}

/** Horizontal bar list — a dependency-free chart that stays readable on phones and to screen readers. */
export function BarList({ rows, format = String }: { rows: { label: string; value: number; sub?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="p-5 text-sm text-muted">No data yet.</p>;
  return (
    <ul className="space-y-3 p-5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-3 text-sm">
            <span className="truncate">{r.label}{r.sub ? <span className="ml-2 text-xs text-faint">{r.sub}</span> : null}</span>
            <span className="tabular-nums text-muted">{format(r.value)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card"><div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function DailyChart({ days, format }: { days: { day: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <div className="p-5">
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label={`Daily values: ${days.map((d) => `${d.day} ${format(d.value)}`).join(", ")}`}>
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day}: ${format(d.value)}`}>
            <div className="w-full rounded-t bg-gradient-to-t from-gold-deep to-gold-bright opacity-80 transition-opacity group-hover:opacity-100" style={{ height: `${Math.max(d.value ? 4 : 1, (d.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint"><span>{days[0]?.day.slice(5)}</span><span>{days.at(-1)?.day.slice(5)}</span></div>
    </div>
  );
}
