import "./load-env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "../src/db";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — skipping migrations.");
    process.exit(process.env.VERCEL ? 1 : 0);
  }
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await closeDb();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
