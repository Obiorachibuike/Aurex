import type { Metadata } from "next";
import { saveNotificationSettingsAction, savePaymentSettingsAction, saveStoreSettingsAction } from "@/actions/admin";
import { AdminHeader, Section } from "@/components/admin/bits";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/bits";
import { requireStaffPage } from "@/lib/auth/session";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/utils";
import { listNotifications } from "@/services/admin";
import { TEMPLATE_LABELS } from "@/services/notifications/templates";
import { getAllSettings } from "@/services/settings";

export const metadata: Metadata = { title: "Settings" };

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return <li className="flex items-start justify-between gap-4 px-5 py-3 text-sm"><span>{label}<span className="block text-xs text-faint">{detail}</span></span><span className={`badge ${ok ? "badge-green" : "badge-amber"}`}>{ok ? "Connected" : "Not set"}</span></li>;
}

export default async function SettingsAdmin() {
  await requireStaffPage("settings.manage");
  const [s, sent] = await Promise.all([getAllSettings(), listNotifications(25)]);
  const st = s.store, pay = s.payments, n = s.notifications;
  const text = (name: keyof typeof st, label: string, type = "text") => (<div><label className="label" htmlFor={`st-${name}`}>{label}</label><input id={`st-${name}`} name={name} type={type} defaultValue={st[name]} className="input" /></div>);
  return (
    <>
      <AdminHeader title="Settings" description="Secret keys are never stored or shown here — they are read from the server's environment variables." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Store information">
          <ActionForm action={saveStoreSettingsAction} className="grid gap-3 p-5 sm:grid-cols-2">
            {text("name", "Store name")}{text("tagline", "Tagline")}{text("legalName", "Legal name")}{text("supportEmail", "Support email", "email")}{text("supportPhone", "Support phone")}{text("whatsapp", "WhatsApp number")}
            <div className="sm:col-span-2">{text("address", "Business address")}</div>
            {text("businessHours", "Business hours")}{text("logoUrl", "Logo image URL (optional)")}
            <div className="sm:col-span-2"><SubmitButton>Save store information</SubmitButton></div>
          </ActionForm>
        </Section>

        <Section title="Connections">
          <ul className="divide-y divide-line">
            <Check ok={!!env.paystack.secretKey} label={`Paystack${env.paymentSimulatorEnabled ? " (TEST SIMULATOR — no real money)" : ""}`} detail="PAYSTACK_SECRET_KEY" />
            <Check ok={!!env.flutterwave.secretKey && !!env.flutterwave.webhookHash} label="Flutterwave" detail="FLUTTERWAVE_SECRET_KEY, FLUTTERWAVE_WEBHOOK_HASH" />
            <Check ok={!!env.resend.apiKey} label="Email delivery (Resend)" detail="RESEND_API_KEY, EMAIL_FROM — without it, emails are recorded but not sent" />
            <Check ok={cloudinaryConfigured()} label="Image uploads (Cloudinary)" detail="CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET" />
            <Check ok={!!env.ai.agnesKey || !!env.ai.openaiKey || !!env.ai.customKey} label="AI model provider" detail="AGNES_API_KEY or OPENAI_API_KEY — without it the built-in engine answers" />
            <Check ok={!!env.cronSecret} label="Scheduled jobs" detail="CRON_SECRET — releases unpaid stock and reconciles payments" />
          </ul>
        </Section>

        <Section title="Payments & tax">
          <ActionForm action={savePaymentSettingsAction} className="space-y-4 p-5">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paystackEnabled" defaultChecked={pay.paystackEnabled} className="check" /> Paystack</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="flutterwaveEnabled" defaultChecked={pay.flutterwaveEnabled} className="check" /> Flutterwave</label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="dp">Default gateway</label><select id="dp" name="defaultProvider" defaultValue={pay.defaultProvider} className="input"><option value="PAYSTACK">Paystack</option><option value="FLUTTERWAVE">Flutterwave</option></select></div>
              <div><label className="label" htmlFor="pw">Hold stock for unpaid orders (minutes)</label><input id="pw" name="paymentWindowMinutes" type="number" min={10} max={1440} defaultValue={pay.paymentWindowMinutes} className="input" /></div>
              <div><label className="label" htmlFor="tl">Tax label</label><input id="tl" name="taxLabel" defaultValue={s.tax.label} className="input" /></div>
              <div><label className="label" htmlFor="tr">Tax rate (%)</label><input id="tr" name="ratePercent" type="number" step="0.1" min={0} max={50} defaultValue={s.tax.ratePercent} className="input" /><p className="hint">0 = no tax line. Confirm the right rate with your accountant.</p></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pricesIncludeTax" defaultChecked={s.tax.pricesIncludeTax} className="check" /> Product prices already include tax</label>
            <SubmitButton>Save payment & tax settings</SubmitButton>
          </ActionForm>
        </Section>

        <Section title="Notifications">
          <ActionForm action={saveNotificationSettingsAction} className="space-y-4 p-5">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="emailEnabled" defaultChecked={n.emailEnabled} className="check" /> Send emails</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="ne">New paid order alerts to</label><input id="ne" name="newOrderEmail" type="email" defaultValue={n.newOrderEmail} placeholder="orders@yourstore.ng" className="input" /></div>
              <div><label className="label" htmlFor="le">Low stock alerts to</label><input id="le" name="lowStockEmail" type="email" defaultValue={n.lowStockEmail} className="input" /></div>
            </div>
            <details>
              <summary className="link cursor-pointer text-sm">Customise email wording</summary>
              <p className="hint">Leave blank to use the default. Order details and amounts are always added automatically.</p>
              <div className="mt-3 space-y-4">
                {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
                  <fieldset key={key} className="rounded-lg border border-line p-3">
                    <legend className="px-1 text-sm">{label}</legend>
                    <input type="hidden" name="templateKey" value={key} />
                    <input name={`subject:${key}`} aria-label={`${label} subject`} defaultValue={n.templates[key]?.subject ?? ""} placeholder="Subject (default)" className="input" />
                    <textarea name={`intro:${key}`} aria-label={`${label} opening message`} defaultValue={n.templates[key]?.intro ?? ""} rows={2} placeholder="Opening message (default)" className="input mt-2" />
                  </fieldset>
                ))}
              </div>
            </details>
            <SubmitButton>Save notification settings</SubmitButton>
          </ActionForm>
        </Section>

        <Section title="Recent notifications" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>Template</th><th>To</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                {sent.map((x) => (<tr key={x.id}><td className="whitespace-nowrap text-muted">{formatDate(x.createdAt, true)}</td><td>{TEMPLATE_LABELS[x.template as keyof typeof TEMPLATE_LABELS] ?? x.template}</td><td className="text-muted">{x.recipient}</td><td><StatusBadge status={x.status} /></td><td className="max-w-xs truncate text-xs text-faint">{x.error ?? ""}</td></tr>))}
                {!sent.length ? <tr><td colSpan={5} className="py-8 text-center text-muted">Nothing sent yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
