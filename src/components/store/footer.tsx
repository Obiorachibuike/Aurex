import { Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { newsletterAction } from "@/actions/account";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Logo } from "@/components/ui/bits";
import { getSetting } from "@/services/settings";

const COLS: [string, [string, string][]][] = [
  ["Shop", [["/products", "All products"], ["/products?category=screens", "Screens"], ["/products?category=batteries", "Batteries"], ["/products?category=charging-ports", "Charging ports"], ["/products?sort=newest", "New arrivals"], ["/products?sale=1", "Offers"]]],
  ["Support", [["/track", "Track an order"], ["/faq", "FAQ"], ["/policies/shipping", "Shipping & delivery"], ["/policies/returns", "Returns & refunds"], ["/policies/warranty", "Warranty"], ["/contact", "Contact us"]]],
  ["Company", [["/about", "About AUREX"], ["/wholesale", "Wholesale"], ["/policies/privacy", "Privacy policy"], ["/policies/terms", "Terms & conditions"], ["/account", "My account"]]],
];

export async function Footer() {
  const store = await getSetting("store");
  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="container-x grid gap-10 py-12 lg:grid-cols-[1.3fr_2fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">{store.tagline} Tested replacement parts and electronic components for technicians, repair shops and phone owners across Nigeria.</p>
          <ul className="mt-5 space-y-2 text-sm text-muted">
            <li className="flex items-center gap-2.5">
              <MapPin className="size-4 text-gold" aria-hidden /> {store.address}
            </li>
            <li className="flex items-center gap-2.5">
              <Phone className="size-4 text-gold" aria-hidden /> <a href={`tel:${store.supportPhone.replace(/\s/g, "")}`}>{store.supportPhone}</a>
            </li>
            <li className="flex items-center gap-2.5">
              <Mail className="size-4 text-gold" aria-hidden /> <a href={`mailto:${store.supportEmail}`}>{store.supportEmail}</a>
            </li>
          </ul>
          <ActionForm action={newsletterAction} resetOnSuccess className="mt-6 max-w-sm">
            <label htmlFor="newsletter-email" className="label">
              Get new arrivals and trade offers
            </label>
            <div className="flex gap-2">
              <input id="newsletter-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="input" />
              <SubmitButton className="shrink-0">Subscribe</SubmitButton>
            </div>
          </ActionForm>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLS.map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <h2 className="eyebrow mb-4">{title}</h2>
              <ul className="space-y-2.5 text-sm text-muted">
                {links.map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="transition-colors hover:text-gold-bright">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="gold-rule" />
      <div className="container-x flex flex-col gap-2 py-5 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} {store.legalName}. All rights reserved.
        </p>
        <p>Payments secured by Paystack · Prices in Nigerian Naira (₦)</p>
      </div>
    </footer>
  );
}
