import { sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "./env";
import { RateLimitError } from "./errors";

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

/**
 * Fixed-window rate limiter.
 * Uses Upstash Redis (REST) when configured, otherwise an atomic PostgreSQL upsert so limits
 * are still enforced across serverless instances.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  if (process.env.DISABLE_RATE_LIMIT === "true" && !env.isProduction) return { allowed: true, remaining: limit, resetAt: new Date() };
  if (env.redis.restUrl && env.redis.restToken) {
    try {
      return await redisLimit(key, limit, windowSeconds);
    } catch {
      /* fall through to PostgreSQL */
    }
  }
  const res = await db.execute<{ count: number; reset_at: Date }>(sql`
    insert into rate_limits (key, count, reset_at)
    values (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    on conflict (key) do update set
      count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
      reset_at = case when rate_limits.reset_at <= now() then now() + make_interval(secs => ${windowSeconds}) else rate_limits.reset_at end
    returning count, reset_at`);
  const row = res.rows[0]!;
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), resetAt: new Date(row.reset_at) };
}

async function redisLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const r = await fetch(`${env.redis.restUrl}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.redis.restToken}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", `rl:${key}`], ["EXPIRE", `rl:${key}`, windowSeconds, "NX"], ["TTL", `rl:${key}`]]),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Redis ${r.status}`);
  const [incr, , ttl] = (await r.json()) as { result: number }[];
  const count = incr!.result;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: new Date(Date.now() + Math.max(ttl?.result ?? windowSeconds, 0) * 1000) };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, message?: string): Promise<void> {
  const r = await rateLimit(key, limit, windowSeconds);
  if (!r.allowed) throw new RateLimitError(message);
}
