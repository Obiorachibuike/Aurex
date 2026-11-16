import "./load-env";
import { closeDb, db } from "../src/db";
import { seedBase } from "../src/db/seed/base";
import { DEMO_PASSWORD, purgeDemo, seedDemo } from "../src/db/seed/demo";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--purge-demo")) {
    const r = await purgeDemo(db);
    console.log(`Removed ${r.products} demo products, demo reviews, demo coupons and demo accounts.`);
  } else {
    await seedBase(db);
    console.log("Base data seeded (roles, permissions, categories, devices, shipping zones, knowledge base).");
    if (args.includes("--demo")) {
      if (process.env.VERCEL_ENV === "production" && !args.includes("--force")) throw new Error("Refusing to seed demo data into a production deployment (pass --force to override).");
      await seedDemo(db);
      console.log(`Demo catalogue seeded. Demo logins (password ${DEMO_PASSWORD}): admin@aurex.test, customer@aurex.test, wholesale@aurex.test`);
    }
  }
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
