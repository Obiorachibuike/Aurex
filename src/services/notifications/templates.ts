import { escapeHtml, formatMoney } from "@/lib/utils";

export type TemplateKey =
  | "welcome_verify"
  | "password_reset"
  | "order_confirmation"
  | "payment_confirmation"
  | "order_processing"
  | "order_ready"
  | "order_shipped"
  | "order_delivered"
  | "order_cancelled"
  | "refund_update"
  | "wholesale_decision"
  | "low_stock_alert"
  | "new_order_alert"
  | "support_ticket";

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  welcome_verify: "Registration & email verification",
  password_reset: "Password reset",
  order_confirmation: "Order confirmation",
  payment_confirmation: "Payment confirmation",
  order_processing: "Order processing",
  order_ready: "Ready for dispatch",
  order_shipped: "Shipping update",
  order_delivered: "Delivery confirmation",
  order_cancelled: "Order cancelled",
  refund_update: "Refund update",
  wholesale_decision: "Wholesale application decision",
  low_stock_alert: "Low stock alert (staff)",
  new_order_alert: "New paid order alert (staff)",
  support_ticket: "Support request received",
};

type P = Record<string, unknown>;
const s = (v: unknown) => escapeHtml(String(v ?? ""));

type Rendered = { subject: string; intro: string; body?: string; cta?: { label: string; url: string } };

function itemsTable(p: P): string {
  const items = (p.items as { name: string; quantity: number; lineTotal: number }[] | undefined) ?? [];
  const currency = String(p.currency ?? "NGN");
  if (!items.length) return "";
  const rows = items
    .map((i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #292929">${s(i.name)} × ${i.quantity}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #292929">${formatMoney(i.lineTotal, currency)}</td></tr>`)
    .join("");
  const total = typeof p.total === "number" ? `<tr><td style="padding:10px 0;font-weight:700">Total</td><td align="right" style="padding:10px 0;font-weight:700;color:#F2C96D">${formatMoney(p.total, currency)}</td></tr>` : "";
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#fff;margin:16px 0">${rows}${total}</table>`;
}

const DEFAULTS: Record<TemplateKey, (p: P) => Rendered> = {
  welcome_verify: (p) => ({
    subject: "Welcome to AUREX — verify your email",
    intro: `Hi ${s(p.name)}, welcome to AUREX. Please confirm your email address to secure your account.`,
    cta: { label: "Verify email", url: String(p.url) },
  }),
  password_reset: (p) => ({
    subject: "Reset your AUREX password",
    intro: `Hi ${s(p.name)}, we received a request to reset your password. This link expires in 60 minutes. If you did not request it, you can ignore this email.`,
    cta: { label: "Reset password", url: String(p.url) },
  }),
  order_confirmation: (p) => ({
    subject: `Order ${p.orderNumber} received — awaiting payment`,
    intro: `Hi ${s(p.name)}, we have received your order ${s(p.orderNumber)}. It will be processed as soon as your payment is confirmed.`,
    body: itemsTable(p),
    cta: { label: "View order", url: String(p.url) },
  }),
  payment_confirmation: (p) => ({
    subject: `Payment confirmed for order ${p.orderNumber}`,
    intro: `Hi ${s(p.name)}, your payment of ${formatMoney(Number(p.total ?? 0), String(p.currency ?? "NGN"))} for order ${s(p.orderNumber)} has been verified. We are preparing it now.`,
    body: itemsTable(p),
    cta: { label: "Track order", url: String(p.url) },
  }),
  order_processing: (p) => ({ subject: `Order ${p.orderNumber} is being processed`, intro: `Hi ${s(p.name)}, your order is being picked and quality-checked.`, cta: { label: "Track order", url: String(p.url) } }),
  order_ready: (p) => ({ subject: `Order ${p.orderNumber} is ready for dispatch`, intro: `Hi ${s(p.name)}, your order is packed and ready to leave our warehouse.`, cta: { label: "Track order", url: String(p.url) } }),
  order_shipped: (p) => ({
    subject: `Order ${p.orderNumber} has shipped`,
    intro: `Hi ${s(p.name)}, your order is on its way.${p.carrier ? ` Carrier: ${s(p.carrier)}.` : ""}${p.trackingNumber ? ` Tracking number: ${s(p.trackingNumber)}.` : ""}`,
    cta: { label: "Track order", url: String(p.url) },
  }),
  order_delivered: (p) => ({ subject: `Order ${p.orderNumber} delivered`, intro: `Hi ${s(p.name)}, your order has been delivered. Thank you for choosing AUREX.`, cta: { label: "View order", url: String(p.url) } }),
  order_cancelled: (p) => ({ subject: `Order ${p.orderNumber} cancelled`, intro: `Hi ${s(p.name)}, your order has been cancelled.${p.reason ? ` Reason: ${s(p.reason)}.` : ""}`, cta: { label: "View order", url: String(p.url) } }),
  refund_update: (p) => ({
    subject: `Refund update for order ${p.orderNumber}`,
    intro: `Hi ${s(p.name)}, your refund request for order ${s(p.orderNumber)} is now: ${s(p.status)}.${p.note ? ` ${s(p.note)}` : ""}`,
    cta: { label: "View order", url: String(p.url) },
  }),
  wholesale_decision: (p) => ({
    subject: p.approved ? "Your AUREX wholesale account is approved" : "Update on your AUREX wholesale application",
    intro: p.approved
      ? `Hi ${s(p.name)}, your wholesale account has been approved. Wholesale pricing is now active when you sign in.`
      : `Hi ${s(p.name)}, we could not approve your wholesale application at this time.${p.note ? ` ${s(p.note)}` : ""}`,
    cta: { label: "Go to my account", url: String(p.url) },
  }),
  low_stock_alert: (p) => ({ subject: `Low stock: ${p.productName} (${p.sku})`, intro: `${s(p.productName)} — ${s(p.sku)} has ${s(p.available)} unit(s) available (threshold ${s(p.threshold)}).`, cta: { label: "Open inventory", url: String(p.url) } }),
  new_order_alert: (p) => ({ subject: `New paid order ${p.orderNumber}`, intro: `Order ${s(p.orderNumber)} from ${s(p.name)} has been paid.`, body: itemsTable(p), cta: { label: "Open order", url: String(p.url) } }),
  support_ticket: (p) => ({ subject: `We received your request (${p.ticketNumber})`, intro: `Hi ${s(p.name) || "there"}, our support team has received your message and will reply shortly. Reference: ${s(p.ticketNumber)}.` }),
};

export function renderTemplate(template: TemplateKey, payload: P, overrides?: { subject?: string; intro?: string }): { subject: string; html: string; text: string } {
  const base = DEFAULTS[template](payload);
  const fill = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => s(payload[k]));
  const subject = overrides?.subject?.trim() ? fill(overrides.subject).replace(/&amp;/g, "&") : base.subject;
  const intro = overrides?.intro?.trim() ? fill(escapeHtml(overrides.intro)) : base.intro;
  const cta = base.cta ? `<p style="margin:28px 0"><a href="${s(base.cta.url)}" style="background:#D6A64C;color:#080808;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;display:inline-block">${s(base.cta.label)}</a></p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#080808;font-family:Arial,Helvetica,sans-serif"><table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 12px"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#181818;border:1px solid #292929;border-radius:14px;padding:32px"><tr><td>
<div style="font-size:26px;letter-spacing:6px;font-weight:800;color:#D6A64C">AUREX</div>
<div style="font-size:10px;letter-spacing:3px;color:#A6A6A6;margin-bottom:24px">BUILT FOR PERFORMANCE</div>
<p style="color:#fff;font-size:15px;line-height:1.6;margin:0">${intro}</p>${base.body ?? ""}${cta}
<p style="color:#A6A6A6;font-size:12px;line-height:1.6;border-top:1px solid #292929;padding-top:16px;margin-top:24px">AUREX — A KodexTeck Company. This is a transactional message about your account or order.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${intro.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"')}${base.cta ? `\n\n${base.cta.label}: ${base.cta.url}` : ""}\n\nAUREX — A KodexTeck Company`;
  return { subject, html, text };
}
