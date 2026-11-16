import { db, type DbOrTx } from "@/db";
import { auditLogs } from "@/db/schema";

const SENSITIVE = /password|secret|token|key|authorization/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? "[redacted]" : scrub(v, depth + 1)]));
}

export async function audit(
  entry: { actorId?: string | null; action: string; entityType: string; entityId?: string | null; metadata?: Record<string, unknown>; ip?: string | null },
  conn: DbOrTx = db,
): Promise<void> {
  await conn.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: (scrub(entry.metadata ?? {}) as Record<string, unknown>) ?? {},
    ip: entry.ip ?? null,
  });
}
