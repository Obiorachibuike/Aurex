import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { seedBase } from "../../src/db/seed/base";
import { seedDemo } from "../../src/db/seed/demo";

/** Boots a throw-away real PostgreSQL, applies the migrations and seeds base + demo data. */
export default async function setup() {
  const url = "postgresql://postgres:postgres@localhost:5439/aurex_test";
  let pg: EmbeddedPostgres | null = null;
  let dir = "";
  if (!process.env.TEST_DATABASE_EXTERNAL) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "aurex-test-pg-"));
    pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: 5439, persistent: false, onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("aurex_test");
  }
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-1234";
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedBase(db);
  await seedDemo(db);
  await pool.end();
  return async () => {
    if (pg) await pg.stop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  };
}
