import { hostname } from 'os';

/**
 * Fire-and-forget alerting for unhandled 5xx errors. Zero external deps — POSTs a
 * plain-text payload to an incoming webhook (Slack `text` / Discord `content` are
 * both included, so one URL works for either). Disabled when ALERT_WEBHOOK_URL is
 * blank, so dev/test never phone home.
 *
 * This is the lightweight tier: it tells you *that* something broke, with the
 * route + stack, so you find out before a customer calls. It is NOT aggregation.
 * ponytail: upgrade path is Sentry (`@sentry/node` in this same 5xx branch) if you
 * need grouping, release tracking, or trends — this covers the "3am silence" gap.
 */

// ponytail: per-process in-memory dedupe. Resets on restart and is not shared
// across replicas — fine for the single-VPS compose deploy; move to Redis if this
// ever runs multi-replica and you want cluster-wide throttling.
const lastSentAt = new Map<string, number>();

function dedupeSeconds(): number {
  const raw = Number(process.env.ALERT_DEDUPE_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

function serviceName(): string {
  return process.env.SERVICE_NAME || hostname();
}

export interface ServerErrorAlert {
  method: string;
  path: string;
  status: number;
  exception: unknown;
}

export function alertServerError({ method, path, status, exception }: ServerErrorAlert): void {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return; // disabled

  const svc = serviceName();
  const errName = exception instanceof Error ? exception.name : 'UnknownError';
  const key = `${svc}|${method} ${path}|${errName}`;

  const now = Date.now();
  const last = lastSentAt.get(key) ?? 0;
  if (now - last < dedupeSeconds() * 1000) return; // throttled
  lastSentAt.set(key, now);
  // Keep the dedupe map from growing without bound on high-cardinality paths.
  if (lastSentAt.size > 500) lastSentAt.clear();

  const stack = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
  const text = [
    `🚨 *${svc}* — HTTP ${status} on \`${method} ${path}\``,
    '```',
    stack.slice(0, 1500),
    '```',
  ].join('\n');

  // Never let alerting break the request path: no await, swallow every failure.
  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
  }).catch(() => undefined);
}
