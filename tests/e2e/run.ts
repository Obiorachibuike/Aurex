/**
 * End-to-end browser tests for the critical AUREX journeys.
 *
 * Requires a running app with the demo catalogue and the payment simulator:
 *   ENABLE_PAYMENT_SIMULATOR=true PAYSTACK_SECRET_KEY=sk_test_simulator \
 *   PAYSTACK_API_URL=http://127.0.0.1:3000/api/dev/paystack-sim npm run dev
 *   npm run db:seed:demo
 * Then: npm run test:e2e   (BASE_URL defaults to http://localhost:3000)
 */
import assert from "node:assert/strict";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { launchBrowser } from "./browser";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "AurexDemo2026!";
const SKU = "AUR-SCR-A154G-SP";
const SLUG = "samsung-galaxy-a15-4g-display-assembly-service-pack";
const only = process.env.E2E_ONLY?.split(",");

const naira = (text: string | null) => Number((text ?? "").replace(/[^\d.]/g, ""));
const tid = (page: Page, id: string) => page.getByTestId(id);

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }), page.click('button[type="submit"]')]);
}

async function addToCart(page: Page, slug: string, qty = 1) {
  await page.goto(`${BASE}/products/${slug}`);
  if (qty !== 1) {
    await tid(page, "quantity-input").first().fill(String(qty));
    await tid(page, "quantity-input").first().blur();
  }
  const badge = tid(page, "cart-count");
  const before = (await badge.count()) ? naira(await badge.first().textContent()) : 0;
  await tid(page, "add-to-cart").first().click();
  await page.waitForFunction((b) => Number(document.querySelector('[data-testid="cart-count"]')?.textContent?.replace(/\D/g, "") ?? 0) > b, before, { timeout: 20_000 });
}

async function checkout(page: Page, opts: { state?: string; guest?: boolean } = {}) {
  await page.goto(`${BASE}/checkout`);
  await tid(page, "checkout-form").waitFor();
  if (opts.guest !== false) {
    await page.fill("#fullName", "Tunde Bakare");
    await page.fill("#phone", "08031234567");
    await page.fill("#email", `tunde.${Date.now()}@example.com`);
  }
  await page.fill("#line1", "12 Allen Avenue");
  await page.fill("#city", "Ikeja");
  await page.selectOption("#state", opts.state ?? "Lagos");
  await tid(page, "shipping-option").first().waitFor({ timeout: 20_000 });
  await tid(page, "shipping-option").first().click();
  return naira(await tid(page, "checkout-total").textContent());
}

const T = (label: string, t0: number) => process.env.E2E_TIMING && console.log(`      [${label}] ${Date.now() - t0}ms`);
async function placeOrder(page: Page) {
  await Promise.all([page.waitForURL(/\/dev\/paystack\//, { timeout: 45_000 }), tid(page, "place-order").click()]);
  return naira(await tid(page, "sim-amount").textContent());
}

async function onHand(admin: Page, sku: string) {
  await admin.goto(`${BASE}/admin/inventory?q=${sku}`);
  return Number(await admin.locator(`[data-sku="${sku}"] [data-testid="on-hand"]`).textContent());
}

type Ctx = { browser: Browser; fresh: () => Promise<{ ctx: BrowserContext; page: Page }>; admin: Page };
const tests: [string, (c: Ctx) => Promise<void>][] = [
  ["compatibility: an ambiguous model asks which device, then filters to parts that fit", async ({ fresh }) => {
    const { page } = await fresh();
    await page.goto(`${BASE}/products?q=${encodeURIComponent("samsung a15 screen")}`);
    await tid(page, "compat-ambiguous").waitFor();
    const choices = tid(page, "device-choice");
    assert.ok((await choices.count()) >= 2, "expected at least two device choices");
    await choices.filter({ hasText: "4G" }).first().click();
    await tid(page, "compat-exact").waitFor();
    const names = await tid(page, "product-card").allTextContents();
    assert.ok(names.length > 0, "expected results for the chosen device");
    assert.ok(!names.some((n) => /A15 5G Display/i.test(n)), "5G-only screen must not be offered for the 4G model");
  }],

  ["guest checkout: cart → totals → simulated payment → order confirmed and stock deducted", async ({ fresh, admin }) => {
    const { page } = await fresh();
    let t0 = Date.now();
    const before = await onHand(admin, SKU); T("onHand", t0); t0 = Date.now();
    await addToCart(page, SLUG, 2); T("addToCart", t0); t0 = Date.now();
    await page.goto(`${BASE}/cart`);
    assert.equal(naira(await tid(page, "cart-subtotal").textContent()), 77_000);
    const total = await checkout(page); T("checkout", t0); t0 = Date.now();
    assert.equal(total, 79_500, "2 × ₦38,500 + ₦2,500 Lagos delivery");
    assert.equal(await placeOrder(page), 79_500, "the gateway is asked for the server-calculated total"); T("placeOrder", t0); t0 = Date.now();
    await Promise.all([page.waitForURL(/\/orders\/AUR-/, { timeout: 45_000 }), tid(page, "sim-pay-success").click()]);
    await tid(page, "payment-success").waitFor();
    assert.equal((await tid(page, "order-status").textContent())?.trim(), "PAID");
    assert.equal(naira(await tid(page, "order-total").textContent()), 79_500);
    assert.equal(await onHand(admin, SKU), before - 2, "stock is deducted exactly once");
    // Reloading the confirmation page (or replaying the callback) must not change anything.
    await page.reload();
    assert.equal(await onHand(admin, SKU), before - 2);
    await page.goto(`${BASE}/cart`);
    assert.equal(await tid(page, "cart-line").count(), 0, "cart is emptied after ordering");
  }],

  ["failed payment: order stays unpaid, stock is not deducted, and the customer can retry", async ({ fresh, admin }) => {
    const { page } = await fresh();
    const before = await onHand(admin, SKU);
    await addToCart(page, SLUG, 1);
    await checkout(page);
    await placeOrder(page);
    await Promise.all([page.waitForURL(/\/orders\/AUR-/, { timeout: 45_000 }), tid(page, "sim-pay-fail").click()]);
    await tid(page, "payment-failed").waitFor();
    assert.notEqual((await tid(page, "order-status").textContent())?.trim(), "PAID");
    assert.equal(await onHand(admin, SKU), before, "a failed payment never deducts stock");
    await Promise.all([page.waitForURL(/\/dev\/paystack\//, { timeout: 45_000 }), tid(page, "pay-now").click()]);
    await Promise.all([page.waitForURL(/\/orders\/AUR-/, { timeout: 45_000 }), tid(page, "sim-pay-success").click()]);
    await tid(page, "payment-success").waitFor();
    assert.equal(await onHand(admin, SKU), before - 1);
  }],

  ["webhook only: payment is confirmed even when the shopper never returns to the store", async ({ fresh }) => {
    const { page } = await fresh();
    await login(page, "customer@aurex.test");
    await addToCart(page, SLUG, 1);
    await checkout(page, { guest: false });
    await placeOrder(page);
    await Promise.all([page.waitForURL(/closed=1/, { timeout: 45_000 }), tid(page, "sim-pay-noreturn").click()]);
    await page.goto(`${BASE}/account/orders`);
    await page.locator('a[href^="/orders/AUR-"]').first().click();
    await page.waitForURL(/\/orders\/AUR-/);
    assert.equal((await tid(page, "order-status").textContent())?.trim(), "PAID");
  }],

  ["wholesale: only approved accounts see and receive wholesale prices", async ({ fresh }) => {
    const retail = await fresh();
    await login(retail.page, "customer@aurex.test");
    await retail.page.goto(`${BASE}/products/${SLUG}`);
    assert.equal(await tid(retail.page, "wholesale-note").count(), 0, "retail customers never see wholesale pricing");
    assert.ok(!(await retail.page.content()).includes("34,000"), "wholesale price must not be in the retail page HTML");

    const { page } = await fresh();
    await login(page, "wholesale@aurex.test");
    await page.goto(`${BASE}/products/${SLUG}`);
    await tid(page, "wholesale-note").waitFor();
    await page.goto(`${BASE}/cart`);
    if (!(await tid(page, "cart-line").count())) {
      await addToCart(page, SLUG, 5);
      await page.goto(`${BASE}/cart`);
    }
    // The demo account's cart persists between runs, so check the unit price rather than a fixed total.
    const qty = Number(await tid(page, "cart-line").first().getByTestId("quantity-input").inputValue());
    assert.ok(qty >= 5);
    assert.equal(naira(await tid(page, "line-total").first().textContent()), qty * 34_000, "wholesale unit price ₦34,000 at or above the minimum quantity");
  }],

  ["access control: customers and guests cannot open the admin area", async ({ fresh }) => {
    const guest = await fresh();
    await guest.page.goto(`${BASE}/admin/orders`);
    assert.ok(!/\/admin/.test(new URL(guest.page.url()).pathname) || (await guest.page.getByText("We couldn't find that page").count()) > 0);
    const { page } = await fresh();
    await login(page, "customer@aurex.test");
    const res = await page.goto(`${BASE}/admin/orders`);
    assert.equal(res?.status(), 404);
    const api = await page.request.post(`${BASE}/api/admin/upload`, { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("x") } }, headers: { origin: BASE } });
    assert.ok([401, 403, 404].includes(api.status()), `upload must be refused for customers (got ${api.status()})`);
  }],

  ["admin: create a product and find it in the store search", async ({ admin, fresh }) => {
    const code = Date.now().toString(36).toUpperCase();
    const name = `E2E Test Speaker ${code}`;
    await admin.goto(`${BASE}/admin/products/new`);
    await admin.fill("#p-name", name);
    await admin.fill("#p-desc", "Loudspeaker module created by the automated test.");
    await admin.selectOption("#p-cat", { label: "Speakers & Microphones" });
    await admin.selectOption("#p-status", "ACTIVE");
    await admin.fill("#v-sku-0", `E2E-SPK-${code}`);
    await admin.fill("#v-rp-0", "4500");
    await admin.fill("#v-wp-0", "3900");
    await admin.fill("#v-st-0", "7");
    await admin.getByLabel("Universal", { exact: false }).check();
    await Promise.all([admin.waitForURL(/\/admin\/products\/[0-9a-f-]{36}\?created=1/, { timeout: 45_000 }), tid(admin, "save-product").click()]);
    await tid(admin, "product-created").waitFor();
    assert.equal(await onHand(admin, `E2E-SPK-${code}`), 7);

    const { page } = await fresh();
    await page.goto(`${BASE}/products?q=${encodeURIComponent(name)}`);
    const card = tid(page, "product-card").filter({ hasText: name });
    await card.first().waitFor();
    assert.match((await card.first().textContent()) ?? "", /4,500/);
    assert.ok(!(await page.content()).includes("3,900"), "wholesale price hidden from guests");
  }],

  ["AI assistant: asks which model, shows real products, and never invents a price", async ({ fresh }) => {
    const { page } = await fresh();
    await page.goto(BASE);
    await tid(page, "chat-launcher").click();
    await tid(page, "chat-panel").waitFor();
    const say = async (text: string) => {
      const n = await tid(page, "chat-assistant").count();
      await tid(page, "chat-input").fill(text);
      await tid(page, "chat-send").click();
      await page.waitForFunction((c) => document.querySelectorAll('[data-testid="chat-assistant"]').length > c, n, { timeout: 45_000 });
      return ((await tid(page, "chat-assistant").last().textContent()) ?? "").trim();
    };
    const first = await say("Do you have a Samsung A15 screen?");
    assert.match(first, /4G|5G/, "must ask which A15 variant instead of guessing");
    assert.equal(await tid(page, "chat-product").count(), 0, "no product is offered while the model is ambiguous");
    await say("The 4G one");
    await tid(page, "chat-product").first().waitFor();
    assert.match((await tid(page, "chat-product").first().textContent()) ?? "", /38,500/);
    const unknown = await say("What is the price of the Nokia 3310 hologram projector?");
    assert.ok(!/₦\s?\d/.test(unknown), "must not invent a price for a product that does not exist");
  }],
];

async function main() {
  const browser = await launchBrowser();
  const fresh = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(25_000);
    return { ctx, page };
  };
  const { page: admin } = await fresh();
  await login(admin, "admin@aurex.test");
  assert.match(admin.url(), /\/admin/, "admin signs in to the dashboard");

  let failed = 0;
  for (const [name, fn] of tests) {
    if (only && !only.some((o) => name.startsWith(o))) continue;
    const started = Date.now();
    const created: BrowserContext[] = [];
    let last: Page | null = null;
    try {
      await fn({ browser, admin, fresh: async () => { const f = await fresh(); created.push(f.ctx); last = f.page; return f; } });
      console.log(`  ✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}\n      ${(e as Error).message.split("\n").slice(0, 6).join("\n      ")}`);
      const p = last as Page | null;
      if (p) { console.log(`      at ${p.url()}`); await p.screenshot({ path: `/tmp/e2e-fail-${failed}.png` }).catch(() => {}); }
    } finally {
      await Promise.all(created.map((c) => c.close().catch(() => {})));
    }
  }
  await browser.close();
  console.log(failed ? `\n${failed} e2e test(s) failed` : "\nAll e2e tests passed");
  process.exit(failed ? 1 : 0);
}
void main();
