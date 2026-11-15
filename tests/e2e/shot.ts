/** Dev utility: `npx tsx tests/e2e/shot.ts <url-path> <out.png> [mobile] [full]` */
import { launchBrowser } from "./browser";

async function main() {
const [, , target = "/", out = "/tmp/shot.png", ...flags] = process.argv;
const mobile = flags.includes("mobile");
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${process.env.BASE_URL ?? "http://localhost:3000"}${target}`, { waitUntil: "networkidle" });
await page.screenshot({ path: out, fullPage: flags.includes("full") });
if (errors.length) console.log("console errors:", errors.slice(0, 5));
await browser.close();
}
void main();
