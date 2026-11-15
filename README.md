# AUREX — Built for Performance.

**A KodexTeck Company.** An online store for mobile phone replacement parts and electronic components in Nigeria, with retail and wholesale pricing, device-compatibility search, Paystack/Flutterwave payments, an admin dashboard and an AI sales assistant.

- [What is included](#what-is-included)
- [Run it on your computer](#run-it-on-your-computer)
- [Put it online with Vercel](#put-it-online-with-vercel)
- [Environment variables](#environment-variables)
- [Running the business day to day](#running-the-business-day-to-day)
- [The AI assistant](#the-ai-assistant)
- [Payments: how money is kept safe](#payments-how-money-is-kept-safe)
- [Tests](#tests)
- [Project layout](#project-layout)
- [Demo data and known limits](#demo-data-and-known-limits)

---

## What is included

**Storefront** — home page, catalogue with search and filters (category, brand, device, price, stock), product pages with images, specifications, compatibility, stock, warranty and reviews, cart, coupon codes, checkout (guest or signed in), order confirmation and tracking, wishlist, customer account, wholesale application, about/contact/FAQ and policy pages.

**Wholesale** — customers apply, staff approve. Only approved accounts see wholesale prices, and only at or above each product's minimum quantity. Extra bulk tiers and customer groups are supported.

**Admin** (`/admin`) — sales overview, orders and fulfilment, payments and refunds, products, categories/brands/device models, inventory with a movement log, customers and roles, wholesale approvals and price rules, coupons, review moderation, delivery zones and fees, support tickets, AI assistant settings/knowledge base/conversations, store settings and an audit log.

**AI assistant** — a chat widget that finds parts, checks compatibility, stock and prices from the live database, answers policy questions from an editable knowledge base, builds a cart, takes delivery details, creates the order only after the customer confirms, and hands back a secure payment link.

**Built with** Next.js (App Router) · React · TypeScript · Tailwind CSS · PostgreSQL · Drizzle ORM · Zod · React Hook Form · Vitest · Playwright.

---

## Run it on your computer

You need [Node.js 20 or newer](https://nodejs.org). You do **not** need to install PostgreSQL — a local database is bundled for development.

```bash
npm install

# 1. Start the bundled development database (leave this window open)
npm run db:dev

# 2. In a second window: create your settings file
cp .env.example .env.local
```

Open `.env.local` and set these lines (the rest can stay empty for now):

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/aurex
AUTH_SECRET=any-long-random-text-at-least-32-characters
APP_URL=http://localhost:3000
CRON_SECRET=another-random-text

# Test payments without a Paystack account:
ENABLE_PAYMENT_SIMULATOR=true
PAYSTACK_SECRET_KEY=sk_test_simulator
PAYSTACK_API_URL=http://127.0.0.1:3000/api/dev/paystack-sim
```

> The bundled database listens on port 5433. To use another port: `DEV_DB_PORT=5440 npm run db:dev` and change `DATABASE_URL` to match.

```bash
# 3. Create the tables, then load the starter data
npm run db:migrate
npm run db:seed:demo      # categories, delivery zones, policies + clearly-labelled demo products

# 4. Start the site
npm run dev
```

Visit <http://localhost:3000>.

| Demo account | Email | Password |
| --- | --- | --- |
| Super administrator | `admin@aurex.test` | `AurexDemo2026!` |
| Retail customer | `customer@aurex.test` | `AurexDemo2026!` |
| Approved wholesale customer | `wholesale@aurex.test` | `AurexDemo2026!` |

Demo coupons: `WELCOME10`, `FREESHIP`.

With the simulator on, "Place order" opens a **test payment page** where you choose *Pay successfully*, *Decline*, or *Pay but don't return* (to prove the webhook alone confirms an order). No real money moves.

---

## Put it online with Vercel

### 1. Create a database

Create a PostgreSQL database with any provider — [Neon](https://neon.tech), [Supabase](https://supabase.com) or Vercel Postgres all work. Copy its **pooled** connection string (it starts with `postgresql://`).

### 2. Import the project

In Vercel choose **Add New → Project**, pick this GitHub repository and keep the defaults. `vercel.json` already tells Vercel to run database migrations before each build.

### 3. Add environment variables

In **Project → Settings → Environment Variables** add at least:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the connection string from step 1 |
| `AUTH_SECRET` | a long random string (`openssl rand -base64 48`) |
| `APP_URL` | your site address, e.g. `https://www.aurex.ng` (no trailing slash) |
| `CRON_SECRET` | a random string (`openssl rand -hex 32`) |
| `PAYSTACK_SECRET_KEY` | from Paystack → Settings → API Keys & Webhooks |

Then deploy. See [all variables](#environment-variables) for email, uploads, Flutterwave and AI.

### 4. Load the starter data and create your admin login

Run these **once** from your computer, pointing at the production database:

```bash
# categories, device models, delivery zones, policies and FAQs (no demo products)
DATABASE_URL="postgresql://…" npm run db:seed

# your own administrator account
DATABASE_URL="postgresql://…" ADMIN_EMAIL="you@yourstore.ng" ADMIN_PASSWORD="a-strong-password" ADMIN_NAME="Your Name" npm run admin:create
```

Do **not** run `db:seed:demo` on the live site unless you want the demo products and demo logins there.

### 5. Connect payment webhooks

Webhooks are how the gateway tells the store a payment succeeded even if the customer closes their browser. Without them, orders are only confirmed when the customer returns to the site or when the daily reconciliation runs.

| Gateway | Where | Webhook URL |
| --- | --- | --- |
| Paystack | Settings → API Keys & Webhooks | `https://YOUR-DOMAIN/api/webhooks/paystack` |
| Flutterwave | Settings → Webhooks (also set a **Secret hash** and put the same value in `FLUTTERWAVE_WEBHOOK_HASH`) | `https://YOUR-DOMAIN/api/webhooks/flutterwave` |

Start with the gateways' **test keys**, place a test order, then switch to live keys.

### 6. Scheduled job

`vercel.json` schedules `/api/cron` once a day. It releases stock held by unpaid orders, re-checks pending payments with the gateway and sends any queued emails. Vercel's free plan allows one run per day; on a paid plan change the schedule in `vercel.json` to `*/10 * * * *` (every 10 minutes) for faster stock release. Staff can also press **Reconcile pending payments** in Admin › Payments at any time.

### 7. Before you launch

- [ ] Replace the placeholder text in Admin › AI assistant › Knowledge base (shipping, returns, warranty, privacy, terms). **Have the privacy policy and terms reviewed by a lawyer** — the supplied text is a starting point, not legal advice.
- [ ] Set your store name, phone, email and address in Admin › Settings.
- [ ] Review delivery zones and fees in Admin › Delivery.
- [ ] Set the tax rate in Admin › Settings (default is 0%; confirm with your accountant).
- [ ] Add your real products; archive or delete anything labelled *Demo*.
- [ ] Verify your sending domain in Resend so emails are not marked as spam.
- [ ] Make sure `ENABLE_PAYMENT_SIMULATOR` is **not** set.

---

## Environment variables

`.env.example` lists every variable with a comment. Summary:

| Variable | Needed? | What it does |
| --- | --- | --- |
| `DATABASE_URL` | **Required** | PostgreSQL connection |
| `AUTH_SECRET` | **Required** | Signs secure links. The app refuses to start in production with a missing or short value |
| `APP_URL` | **Required** | Public site address used in emails, payment callbacks, sitemap |
| `CRON_SECRET` | **Required** | Protects the scheduled job endpoint |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | One gateway required | Paystack |
| `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_WEBHOOK_HASH` | Optional | Flutterwave |
| `RESEND_API_KEY`, `EMAIL_FROM` | Recommended | Sends emails. Without it emails are logged but not delivered |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Recommended | Product image uploads. Without it, paste image links instead |
| `AGNES_API_KEY` / `OPENAI_API_KEY` / `AI_CUSTOM_API_KEY` | Optional | Connects a language model to the assistant |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional | Faster shared rate limiting |
| `SENTRY_DSN` | Optional | Error reporting |

Secret keys live only in environment variables. They are never stored in the database, shown in the admin, or sent to the browser. Admin › Settings shows which services are connected.

---

## Running the business day to day

| Task | Where |
| --- | --- |
| Add or edit a product, prices, images, compatible phones | Admin › Products |
| Receive stock, correct a count | Admin › Inventory (every change is logged) |
| Process an order: Paid → Processing → Ready → Shipped → Delivered | Admin › Orders → open the order |
| Approve or decline a refund request | Admin › Payments & refunds |
| Approve a wholesale applicant | Admin › Wholesale |
| Create a discount code | Admin › Coupons & reviews |
| Change delivery fees | Admin › Delivery |
| Give a staff member access | Admin › Customers → open the person → Role *(super administrator only)* |
| See who changed what | Admin › Audit log |

**Staff roles**

| Role | Can do |
| --- | --- |
| Super administrator | Everything, including roles and settings |
| Administrator | Everything except changing staff roles |
| Inventory manager | Products, categories, stock; view orders |
| Support agent | View orders and customers, handle tickets and chats |

**Adding device models correctly matters.** In Admin › Categories & devices each phone model has *aliases* — the short names customers type. If two models share an alias (for example "A15" for both the Galaxy A15 4G and A15 5G), the store and the assistant ask the customer which one they have instead of guessing. Give each product only the exact models it fits.

**Prices** are typed in naira in the admin and stored exactly (in kobo) so totals never suffer rounding errors.

---

## The AI assistant

Open Admin › AI assistant.

- **Provider.** Out of the box the assistant uses a built-in engine that needs no API key and handles product search, compatibility questions, cart, checkout, order tracking and knowledge-base answers. To use a language model for more natural conversation, add `AGNES_API_KEY` (or `OPENAI_API_KEY`) as an environment variable, redeploy, then choose the provider and model name on this page. Any OpenAI-compatible endpoint can be used via *Custom*.
- **If the model provider is down** or returns an error, the assistant falls back to the built-in engine automatically.
- **Knowledge base.** Policy and business answers come only from the entries you publish here. The store's FAQ and policy pages are generated from the same entries, so there is one place to edit.
- **Questions to fix.** Anything the assistant could not answer, or that a customer marked 👎, appears here so you can add the missing answer.
- **Hand-over.** When a customer asks for a person (or the assistant cannot help), a support ticket is created. Staff reply from the conversation page and the reply appears in the customer's chat.
- **Cost.** Token usage is recorded per reply. Enter your provider's price per 1,000 tokens to see an estimated cost; the figure is an estimate, not a bill.

**Safeguards that cannot be switched off from the admin**

- Prices, stock, compatibility and order details come only from server tools that read the database. Product cards and totals shown in chat are built from those results, not from the model's wording.
- An order is created only after the customer confirms an exact summary. The confirmation is tied to the cart contents and address; if either changes, the customer is asked again.
- The assistant can look up an order only for the signed-in owner, for an order created in the same chat, or when the customer supplies the order number **and** the email used at checkout.
- It never takes card details; payment always happens on the gateway's page.
- Wholesale prices are returned only to approved wholesale accounts.
- Every tool call is logged and visible to staff.

---

## Payments: how money is kept safe

1. The server recalculates the total from current prices, coupon rules and delivery fees. Totals sent by the browser are ignored.
2. Stock is **reserved** when the order is placed, inside a database transaction with row locks, so two customers cannot buy the last unit.
3. The customer pays on the gateway's hosted page.
4. An order becomes **Paid** only after the server asks the gateway to verify the transaction and the amount and currency match. A browser redirect alone never marks an order paid.
5. Webhooks are signature-checked, recorded once (repeats are ignored), then re-verified with the gateway.
6. Stock is deducted exactly once, when payment is verified. Failed or expired payments release the reservation.
7. If a payment arrives after the reservation expired and the item has sold out, the payment is flagged **Requires review** for staff rather than overselling.
8. Staff cannot mark an order paid by hand; they can only ask the gateway to re-check it.
9. Refunds go through the gateway and are recorded with who approved them.

---

## Tests

```bash
npm run lint          # code style
npm run typecheck     # TypeScript
npm test              # unit + integration tests (starts its own temporary database)
npm run test:e2e      # browser tests — needs the site running with demo data and the simulator
npm run build         # production build
```

| Suite | Covers |
| --- | --- |
| Unit (`tests/unit`) | Retail/wholesale pricing rules, order totals, coupons, delivery fees, device and query matching |
| Integration (`tests/integration`) | Registration and sign-in, sessions, password reset, roles; product creation and search; inventory; cart; checkout; concurrent purchases of limited stock; payment verification, webhooks, duplicates, amount mismatch, failed and late payments; order access control; refunds; AI tools, permissions and order confirmation |
| End-to-end (`tests/e2e`) | Compatibility prompt, guest checkout with simulated payment and stock deduction, failed payment and retry, webhook-only confirmation, wholesale visibility, admin access control, admin product creation, assistant conversation |

The integration tests use a stand-in for the payment gateways and a scripted stand-in for the language model. **Live Paystack, Flutterwave, Agnes AI, Resend and Cloudinary accounts were not exercised** — test each with its sandbox/test keys before going live.

---

## Project layout

```
drizzle/                 SQL migrations (generated — do not edit by hand)
public/demo/             Demo product photos
scripts/                 dev database, migrate, seed, create-admin
src/
  app/(store)/           Customer-facing pages
  app/admin/             Admin dashboard pages
  app/api/               Webhooks, assistant, search suggestions, cron, health, uploads
  app/dev/, api/dev/     Payment simulator (development only)
  actions/               Server actions: validated, rate-limited entry points used by forms
  components/            UI components
  db/                    Database schema and seed data
  lib/                   Environment, validation, sessions, permissions, rate limiting, utilities
  services/              Business logic: pricing, cart, orders, payments, inventory, catalogue, AI
tests/                   Unit, integration and end-to-end tests
```

Changing the database: edit `src/db/schema.ts`, run `npm run db:generate -- --name what_changed`, commit the new file in `drizzle/`. Migrations run automatically on the next Vercel deploy.

`GET /api/health` returns the database status for uptime monitors.

---

## Demo data and known limits

- Demo products, reviews and accounts are flagged as demo in the database and labelled in the admin. The demo product photos are AI-generated illustrations, not photographs of real stock. Prices and compatibility in the demo data are examples only.
- Card payments, bank transfer, USSD and other channels are provided by Paystack/Flutterwave on their pages; this project does not process cards itself.
- One currency (NGN) and delivery within Nigeria.
- Notifications are sent by email. SMS and WhatsApp are not included.
- The courier's tracking number is typed in by staff; there is no automatic courier integration.
- Rate limiting uses the database unless Upstash Redis is configured.
- The daily scheduled job on Vercel's free plan means an abandoned order may hold its stock for up to a day unless staff press *Reconcile pending payments* or the schedule is increased.
