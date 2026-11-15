import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — services accept either. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __aurexPool?: Pool; __aurexDb?: Db };

function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  const needsSsl = /sslmode=require|neon\.tech|supabase\.co|render\.com|amazonaws\.com/.test(url) && !/sslmode=disable/.test(url);
  return new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    ssl: needsSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "true" } : undefined,
  });
}

export function getPool(): Pool {
  return (globalForDb.__aurexPool ??= createPool());
}

/** Lazily initialised so importing this module never requires a database (e.g. during build). */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = (globalForDb.__aurexDb ??= drizzle(getPool(), { schema }));
    const value = Reflect.get(real as object, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export async function closeDb(): Promise<void> {
  await globalForDb.__aurexPool?.end();
  globalForDb.__aurexPool = undefined;
  globalForDb.__aurexDb = undefined;
}

export { schema };
