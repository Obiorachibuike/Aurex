import { env } from "./env";

type Context = Record<string, unknown>;

/**
 * Minimal error monitoring: structured logs always, plus Sentry (envelope API) when SENTRY_DSN is set.
 * Kept dependency-free so it works in every runtime.
 */
export function reportError(error: unknown, context: Context = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(JSON.stringify({ level: "error", message: err.message, name: err.name, stack: err.stack, ...context, at: new Date().toISOString() }));
  const dsn = env.sentryDsn;
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const header = { event_id: eventId, sent_at: new Date().toISOString(), dsn };
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames: [] } }] },
      extra: { ...context, stack: err.stack },
    };
    const body = `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
    void fetch(`${u.protocol}//${u.host}/api/${projectId}/envelope/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=aurex/1.0` },
      body,
    }).catch(() => {});
  } catch {
    /* never let monitoring break a request */
  }
}

export function logInfo(message: string, context: Context = {}): void {
  if (process.env.NODE_ENV === "test") return;
  console.log(JSON.stringify({ level: "info", message, ...context, at: new Date().toISOString() }));
}
