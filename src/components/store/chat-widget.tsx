"use client";

import { ArrowUp, Check, ExternalLink, Headset, Loader2, Lock, MessageCircle, RotateCcw, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessageView } from "@/services/ai/agent";
import type { ChatAttachment, LineAttachment } from "@/services/ai/types";
import { cn, formatMoney } from "@/lib/utils";

type Msg = ChatMessageView & { pending?: boolean; failed?: boolean };
const OPEN_EVENT = "aurex:open-chat";
const SUGGESTIONS = ["I need a screen for Samsung A15", "How much is delivery to Lagos?", "What is your return policy?", "Track my order"];

/** Any element can open the assistant (optionally with a first message). */
export function openAssistant(text?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { text } }));
}

export function OpenChatButton({ children, className, text }: { children: ReactNode; className?: string; text?: string }) {
  return (
    <button type="button" className={className} onClick={() => openAssistant(text)}>
      {children}
    </button>
  );
}

function Lines({ lines }: { lines: LineAttachment[] }) {
  return (
    <ul className="divide-y divide-line">
      {lines.map((l) => (
        <li key={l.variantId} className="flex justify-between gap-3 py-2 text-[0.8rem]">
          <span className="min-w-0">
            <span className="line-clamp-2">{l.name}</span>
            <span className="text-faint">
              {l.quantity} × {formatMoney(l.unitPrice)}
            </span>
          </span>
          <span className="shrink-0 font-medium tabular-nums">{formatMoney(l.lineTotal)}</span>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 text-[0.8rem]", strong ? "border-t border-line pt-2 text-sm font-semibold" : "text-muted")}>
      <span>{label}</span>
      <span className={cn("tabular-nums", strong && "text-gold-bright")}>{value}</span>
    </div>
  );
}

function Attachment({ a, send, busy, latest }: { a: ChatAttachment; send: (text: string, confirm?: boolean) => void; busy: boolean; latest: boolean }) {
  switch (a.type) {
    case "products":
      return (
        <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1">
          {a.items.map((p) => (
            <div key={p.variantId ?? p.productId} className="w-[11.5rem] shrink-0 snap-start overflow-hidden rounded-xl border border-line bg-surface" data-testid="chat-product">
              <Link href={`/products/${p.slug}`} className="relative block aspect-[4/3] bg-card">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tiny thumbnails inside the chat panel
                  <img src={p.imageUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                ) : null}
              </Link>
              <div className="space-y-1.5 p-2.5">
                <p className="line-clamp-2 text-[0.78rem] leading-snug font-medium">{p.name}</p>
                <p className="text-[0.7rem] text-faint">{[p.qualityGrade, p.warrantyMonths ? `${p.warrantyMonths}-mo warranty` : null].filter(Boolean).join(" · ")}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gold-bright tabular-nums">{formatMoney(p.price)}</span>
                  <span className={cn("text-[0.68rem]", p.inStock ? "text-success" : "text-danger")}>{p.inStock ? `${p.available} in stock` : "Out of stock"}</span>
                </div>
                <button type="button" className="btn btn-outline btn-sm w-full" disabled={busy || !p.inStock} onClick={() => send(`Add ${p.name}`)}>
                  Add to cart
                </button>
              </div>
            </div>
          ))}
        </div>
      );
    case "options":
      return (
        <div className="flex flex-wrap gap-2">
          {a.options.map((o) => (
            <button key={o.value} type="button" className="btn btn-outline btn-sm" disabled={busy || !latest} onClick={() => send(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      );
    case "cart":
      return (
        <div className="rounded-xl border border-line bg-surface p-3" data-testid="chat-cart">
          <p className="eyebrow mb-1">Your cart · {a.itemCount} item{a.itemCount === 1 ? "" : "s"}</p>
          <Lines lines={a.lines} />
          <Row label="Subtotal" value={formatMoney(a.subtotal)} strong />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-gold btn-sm" disabled={busy || !latest} onClick={() => send("Checkout")}>
              Checkout here
            </button>
            <Link href="/cart" className="btn btn-outline btn-sm">
              Open cart
            </Link>
          </div>
        </div>
      );
    case "order_summary":
      return (
        <div className="rounded-xl border border-gold/40 bg-surface p-3" data-testid="chat-order-summary">
          <p className="eyebrow mb-1">Order summary — not placed yet</p>
          <Lines lines={a.lines} />
          <div className="space-y-1 border-t border-line pt-2">
            <Row label="Subtotal" value={formatMoney(a.subtotal)} />
            {a.discount > 0 ? <Row label="Discount" value={`− ${formatMoney(a.discount)}`} /> : null}
            <Row label={`Delivery · ${a.shippingMethod}`} value={a.shipping === 0 ? "Free" : formatMoney(a.shipping)} />
            {a.tax > 0 ? <Row label="Tax" value={formatMoney(a.tax)} /> : null}
            <Row label="Total to pay" value={formatMoney(a.total)} strong />
          </div>
          <dl className="mt-2 space-y-1 text-[0.75rem] text-muted">
            <div>
              <dt className="inline text-faint">Deliver to: </dt>
              <dd className="inline">{a.deliverTo}</dd>
            </div>
            <div>
              <dt className="inline text-faint">Contact: </dt>
              <dd className="inline">{a.contact}</dd>
            </div>
            <div>
              <dt className="inline text-faint">Estimated delivery: </dt>
              <dd className="inline">{a.eta}</dd>
            </div>
          </dl>
          {latest ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-gold btn-sm" disabled={busy} onClick={() => send("Confirm order", true)} data-testid="chat-confirm">
                <Check className="size-4" aria-hidden /> Confirm order
              </button>
              <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => send("Change the delivery details")}>
                Change details
              </button>
            </div>
          ) : null}
        </div>
      );
    case "payment":
      return (
        <div className="rounded-xl border border-gold/40 bg-surface p-3" data-testid="chat-payment">
          <p className="eyebrow mb-1">Order {a.orderNumber}</p>
          <p className="text-sm">
            Amount due: <strong className="text-gold-bright tabular-nums">{formatMoney(a.total)}</strong>
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-[0.75rem] text-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-gold" aria-hidden /> You pay on our payment partner&apos;s secure page. Your order is confirmed only after the payment is verified.
          </p>
          <div className="mt-3 grid gap-2">
            {a.paymentUrl ? (
              <a href={a.paymentUrl} className="btn btn-gold btn-sm" data-testid="chat-pay-link">
                <ShieldCheck className="size-4" aria-hidden /> Pay securely
              </a>
            ) : null}
            <a href={a.orderUrl} className="btn btn-outline btn-sm">
              View order <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </div>
      );
    case "order_status":
      return (
        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="eyebrow mb-1">Order {a.orderNumber}</p>
          <p className="text-sm">
            Status: <strong>{a.statusLabel}</strong> · {formatMoney(a.total)}
          </p>
          {a.orderUrl ? (
            <a href={a.orderUrl} className="btn btn-outline btn-sm mt-3 w-full">
              View order
            </a>
          ) : null}
        </div>
      );
    case "handoff":
      return (
        <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-3 text-[0.8rem]">
          <Headset className="size-5 shrink-0 text-gold" aria-hidden />
          <span>
            Support request <strong>{a.ticketNumber}</strong> is open. A human agent will reply here and by email.
          </span>
        </div>
      );
  }
}

export function ChatWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [escalated, setEscalated] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queued = useRef<string | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/assistant", { cache: "no-store" });
      const data = (await res.json()) as { enabled: boolean; status: string | null; messages: ChatMessageView[] };
      setEnabled(data.enabled !== false);
      setEscalated(data.status === "ESCALATED");
      if (!busyRef.current) setMessages(data.messages ?? []);
    } catch {
      setError("We couldn't load the conversation. Check your connection and try again.");
    } finally {
      setLoaded(true);
    }
  }, []);

  const send = useCallback(
    async (text: string, confirm = false) => {
      const clean = text.trim();
      if (!clean || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const temp: Msg = { id: `tmp-${Date.now()}`, role: "user", content: clean, attachments: [], feedback: null, createdAt: new Date().toISOString(), pending: true };
      setMessages((m) => [...m, temp]);
      try {
        const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: clean, confirm }) });
        const data = (await res.json().catch(() => ({}))) as { messages?: ChatMessageView[]; error?: string };
        if (!res.ok || !data.messages) throw new Error(data.error ?? "The assistant is unavailable right now. Please try again.");
        setMessages((m) => [...m.map((x) => (x.id === temp.id ? { ...x, pending: false } : x)), ...data.messages!]);
        const kinds = data.messages.flatMap((m) => m.attachments.map((a) => a.type));
        if (kinds.includes("handoff")) setEscalated(true);
        if (kinds.some((k) => k === "cart" || k === "payment")) router.refresh(); // keep the header cart badge in sync
      } catch (e) {
        setMessages((m) => m.map((x) => (x.id === temp.id ? { ...x, pending: false, failed: true } : x)));
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      } finally {
        busyRef.current = false;
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [router],
  );

  useEffect(() => {
    const onOpen = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (text) queued.current = text;
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    // State is only set after the network request resolves, never synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!loaded) void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const mobile = window.matchMedia("(max-width: 639px)").matches;
    if (mobile) document.body.style.overflow = "hidden";
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      clearTimeout(t);
    };
  }, [open, loaded, load]);

  useEffect(() => {
    if (open && loaded && enabled && queued.current) {
      const text = queued.current;
      queued.current = null;
      void send(text);
    }
  }, [open, loaded, enabled, send]);

  // While a human agent is handling the chat, poll for their replies.
  useEffect(() => {
    if (!open || !escalated) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !busyRef.current) void load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [open, escalated, load]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  const feedback = async (id: string, value: 1 | -1) => {
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, feedback: value } : x)));
    await fetch("/api/assistant/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: id, value }) }).catch(() => undefined);
  };

  const restart = async () => {
    if (busy || !window.confirm("Start a new conversation? Your cart is kept.")) return;
    await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "end" }) }).catch(() => undefined);
    setMessages([]);
    setEscalated(false);
    setError(null);
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role !== "user")?.id;

  return (
    <>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} data-testid="chat-launcher" aria-label="Open the AUREX assistant" className="btn btn-gold fixed right-4 bottom-4 z-40 h-14 rounded-full px-5 shadow-2xl shadow-black/60 sm:right-6 sm:bottom-6">
          <MessageCircle className="size-5" aria-hidden />
          <span className="hidden sm:inline">Ask AUREX</span>
        </button>
      ) : null}

      {open ? (
        <section role="dialog" aria-modal="false" aria-label="AUREX assistant" data-testid="chat-panel" className="fixed inset-0 z-50 flex animate-pop flex-col bg-bg sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[min(680px,calc(100dvh-3rem))] sm:w-[25.5rem] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl sm:shadow-black/70">
          <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-b from-gold-bright to-gold text-black">
              <Sparkles className="size-4.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm leading-tight font-semibold">AUREX Assistant</h2>
              <p className="truncate text-[0.72rem] text-muted">{escalated ? "A human agent has been notified" : "Parts, compatibility, orders & delivery"}</p>
            </div>
            <button type="button" className="btn btn-ghost btn-icon size-9 min-h-0" onClick={restart} aria-label="Start a new conversation" title="New conversation">
              <RotateCcw className="size-4" />
            </button>
            <button type="button" className="btn btn-ghost btn-icon size-9 min-h-0" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X className="size-5" />
            </button>
          </header>

          <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-3.5 py-4" role="log" aria-live="polite" aria-relevant="additions">
            {!loaded ? (
              <div className="space-y-3" aria-label="Loading conversation">
                <div className="skeleton h-14 w-4/5" />
                <div className="skeleton ml-auto h-9 w-1/2" />
                <div className="skeleton h-20 w-4/5" />
              </div>
            ) : !enabled ? (
              <p className="panel p-4 text-sm text-muted">
                The assistant is switched off at the moment. Please use the <Link href="/contact" className="link">contact page</Link> and our team will help you.
              </p>
            ) : messages.length === 0 ? (
              <div className="animate-fade-up">
                <p className="max-w-[90%] rounded-2xl rounded-tl-sm border border-line bg-card px-3.5 py-2.5 text-[0.88rem] leading-relaxed">
                  Hello! I can help you find the right part for your phone, check prices and stock, answer delivery and warranty questions, and place an order for you. What do you need?
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="rounded-full border border-line px-3 py-1.5 text-[0.78rem] text-muted transition-colors hover:border-gold hover:text-gold-bright" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.role === "user";
                return (
                  <div key={m.id} className={cn("flex flex-col gap-2", mine ? "items-end" : "items-start")} data-testid={mine ? "chat-user" : "chat-assistant"}>
                    {m.role === "agent" ? <span className="badge badge-gold">Human agent</span> : null}
                    {m.content ? (
                      <p className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[0.88rem] leading-relaxed break-words whitespace-pre-wrap", mine ? "rounded-tr-sm bg-gold text-black" : "rounded-tl-sm border border-line bg-card", m.pending && "opacity-70", m.failed && "bg-danger/30 text-ink")}>{m.content}</p>
                    ) : null}
                    {m.failed ? <span className="text-[0.7rem] text-danger">Not sent</span> : null}
                    {m.attachments.map((a, i) => (
                      <div key={i} className="w-full max-w-full">
                        <Attachment a={a} send={send} busy={busy} latest={m.id === lastAssistant} />
                      </div>
                    ))}
                    {m.role === "assistant" && m.content ? (
                      <div className="flex items-center gap-1 text-faint">
                        <button type="button" aria-label="Helpful" aria-pressed={m.feedback === 1} onClick={() => feedback(m.id, 1)} className={cn("rounded p-1 hover:text-ink", m.feedback === 1 && "text-success")}>
                          <ThumbsUp className="size-3.5" />
                        </button>
                        <button type="button" aria-label="Not helpful" aria-pressed={m.feedback === -1} onClick={() => feedback(m.id, -1)} className={cn("rounded p-1 hover:text-ink", m.feedback === -1 && "text-danger")}>
                          <ThumbsDown className="size-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
            {busy ? (
              <div className="flex items-center gap-2 text-xs text-muted" role="status">
                <Loader2 className="size-3.5 animate-spin text-gold" aria-hidden /> Checking live stock and prices…
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-[#ffc9c3]">
                {error}
              </p>
            ) : null}
          </div>

          {enabled ? (
            <form
              className="border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              onSubmit={(e) => {
                e.preventDefault();
                const text = input;
                setInput("");
                void send(text);
              }}
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, 1000))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={1}
                  placeholder="Type your message…"
                  aria-label="Message"
                  data-testid="chat-input"
                  enterKeyHint="send"
                  className="input max-h-28 min-h-11 flex-1 resize-none py-2.5"
                />
                <button type="submit" className="btn btn-gold btn-icon shrink-0" disabled={busy || !input.trim()} aria-label="Send message" data-testid="chat-send">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[0.68rem] text-faint">
                <span>Prices and stock come live from our store. Payment is always on a secure gateway.</span>
                {!escalated ? (
                  <button type="button" className="shrink-0 underline-offset-2 hover:text-gold-bright hover:underline" onClick={() => send("I would like to talk to a human agent")} disabled={busy}>
                    Talk to a person
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
