"use client";

import { Search, Smartphone, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Suggestions = { products: { name: string; slug: string }[]; devices: { id: string; label: string }[]; categories: { name: string; slug: string }[] };
type Item = { key: string; label: string; href: string; kind: "device" | "category" | "product" };

export function SearchBox({ className, defaultValue = "", autoFocus }: { className?: string; defaultValue?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(defaultValue);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const s = (await res.json()) as Suggestions;
        setItems([
          ...s.devices.map((d) => ({ key: `d${d.id}`, label: d.label, href: `/products?device=${d.id}`, kind: "device" as const })),
          ...s.categories.map((c) => ({ key: `c${c.slug}`, label: c.name, href: `/products?category=${c.slug}`, kind: "category" as const })),
          ...s.products.map((p) => ({ key: `p${p.slug}`, label: p.name, href: `/products/${p.slug}`, kind: "product" as const })),
        ]);
        setActive(-1);
      } catch {
        /* aborted or offline — suggestions are optional */
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const visible = open && q.trim().length >= 2 && items.length > 0;
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <form
      ref={box}
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const chosen = visible && active >= 0 ? items[active] : undefined;
        if (chosen) go(chosen.href);
        else if (q.trim()) go(`/products?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
      <input
        type="search"
        name="q"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!visible) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search parts or phone model"
        aria-label="Search products"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        enterKeyHint="search"
        className="input pr-3 pl-10"
      />
      {visible ? (
        <ul id={listId} role="listbox" className="card absolute top-full right-0 left-0 z-50 mt-2 max-h-[60vh] animate-pop overflow-auto p-1.5 shadow-2xl shadow-black/60">
          {items.map((it, i) => (
            <li key={it.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(it.href)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm", i === active ? "bg-raised text-ink" : "text-[#d4d4d4]")}>
                {it.kind === "device" ? <Smartphone className="size-4 shrink-0 text-gold" aria-hidden /> : it.kind === "category" ? <Tag className="size-4 shrink-0 text-gold" aria-hidden /> : <Search className="size-4 shrink-0 text-faint" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <span className="shrink-0 text-[0.65rem] tracking-wider text-faint uppercase">{it.kind === "device" ? "Parts for" : it.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
