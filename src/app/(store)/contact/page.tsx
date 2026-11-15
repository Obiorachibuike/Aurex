import { Clock, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { contactAction } from "@/actions/account";
import { OpenChatButton } from "@/components/store/chat-widget";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { PageHeader } from "@/components/ui/bits";
import { getViewer } from "@/lib/viewer";
import { getSetting } from "@/services/settings";

export const metadata: Metadata = { title: "Contact us", description: "Contact AUREX support for help with orders, compatibility, wholesale and warranty.", alternates: { canonical: "/contact" } };

export default async function ContactPage() {
  const [store, { user }] = await Promise.all([getSetting("store"), getViewer()]);
  return (
    <>
      <PageHeader eyebrow="Support" title="Contact us">We reply to every message, usually within one business day.</PageHeader>
      <div className="container-x grid gap-8 py-10 lg:grid-cols-[1.4fr_1fr]">
        <ActionForm action={contactAction} inlineSuccess resetOnSuccess className="panel space-y-4 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="name" className="label">Your name</label><input id="name" name="name" required defaultValue={user?.name ?? ""} autoComplete="name" className="input" /></div>
            <div><label htmlFor="email" className="label">Email address</label><input id="email" name="email" type="email" required defaultValue={user?.email ?? ""} autoComplete="email" className="input" /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="phone" className="label">Phone (optional)</label><input id="phone" name="phone" type="tel" autoComplete="tel" className="input" /></div>
            <div><label htmlFor="subject" className="label">Subject</label><input id="subject" name="subject" required maxLength={150} className="input" /></div>
          </div>
          {/* Honeypot: hidden from people, tempting for bots. */}
          <div className="hidden" aria-hidden><label>Company<input name="company" tabIndex={-1} autoComplete="off" /></label></div>
          <div><label htmlFor="message" className="label">How can we help?</label><textarea id="message" name="message" required minLength={10} maxLength={3000} rows={6} className="input" placeholder="Include your order number if this is about an order." /></div>
          <SubmitButton pendingLabel="Sending…">Send message</SubmitButton>
        </ActionForm>
        <aside className="space-y-4">
          <ul className="panel space-y-4 p-6 text-sm text-muted">
            <li className="flex gap-3"><Mail className="size-4 shrink-0 text-gold" aria-hidden /><a href={`mailto:${store.supportEmail}`} className="link">{store.supportEmail}</a></li>
            <li className="flex gap-3"><Phone className="size-4 shrink-0 text-gold" aria-hidden />{store.supportPhone}</li>
            <li className="flex gap-3"><MapPin className="size-4 shrink-0 text-gold" aria-hidden />{store.address}</li>
            <li className="flex gap-3"><Clock className="size-4 shrink-0 text-gold" aria-hidden />{store.businessHours}</li>
          </ul>
          <div className="panel p-6">
            <p className="font-medium">Need an answer now?</p>
            <p className="mt-1.5 text-sm text-muted">The AUREX assistant can check stock, compatibility and order status instantly, and hand over to a person when needed.</p>
            <OpenChatButton className="btn btn-outline mt-4 w-full">Chat with the assistant</OpenChatButton>
          </div>
        </aside>
      </div>
    </>
  );
}
