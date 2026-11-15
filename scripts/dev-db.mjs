// Starts a disposable local PostgreSQL for development (no Docker required).
// Data lives in .local/pgdata. Use a managed PostgreSQL in production.
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const dir = process.env.DEV_DB_DIR ?? ".local/pgdata";
const fresh = !fs.existsSync(`${dir}/PG_VERSION`);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: true, onLog: () => {} });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase("aurex");
console.log(`PostgreSQL ready: postgresql://postgres:postgres@localhost:${port}/aurex`);
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
