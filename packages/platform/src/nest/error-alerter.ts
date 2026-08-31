import { hostname } from 'os';

import { captureServerError } from './sentry';

/**
 * Fire-and-forget alerting for unhandled 5xx errors. Zero external deps — POSTs a
 * plain-text payload to an incoming webhook (Slack `text` / Discord `content` are
 * both included, so one URL works for either). Disabled when ALERT_WEBHOOK_URL is
 * blank, so dev/test never phone home.
 *
 * This is the lightweight tier: it tells you *that* something broke, with the
 * route + stack, so you find out before a customer calls. It is NOT aggregation.
 * The aggregation tier IS here now (`./sentry`, called from the same 5xx branch below) and
 * is DSN-gated: with SENTRY_DSN blank this module behaves exactly as it always did.
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

/*
 * A health endpoint answering 503 is this system TELLING you the database is unreachable. It
 * is not the system failing to do its job — it is the system doing exactly its job.
 *
 * That distinction is a quota question, not a philosophical one. `/health` is polled by the
 * Docker healthcheck every 30s and by Prometheus on its own interval, across 18 services. One
 * database blip of ten minutes therefore produces several HUNDRED identical Sentry events for
 * a single known cause — enough to consume a large share of a month's free-tier quota in one
 * incident, and to bury every real exception underneath it. That already happened: the first
 * ServiceUnavailableException in this project's Sentry came from promo-service's health
 * controller, thrown deliberately on `database !== 'up'`.
 *
 * The absence is covered by better instruments, which is what makes dropping it safe rather
 * than convenient: `PostgresDown` and `ServiceDown` in ops/alert-rules.yml fire on exactly
 * this, both now with promtool fixtures, and the webhook tier below still sends one message a
 * minute. Nothing goes unnoticed; it stops being counted 300 times.
 *
 * Narrow on purpose: 503 only, and only from a health path. A BUG in a health controller is a
 * 500, and a 500 is still reported — which is the difference between suppressing noise and
 * suppressing evidence.
 */
function isHealthSignal(path: string, status: number): boolean {
  return status === 503 && /\/health\/?(\?.*)?$/.test(path);
}

export function alertServerError({ method, path, status, exception }: ServerErrorAlert): void {
  /*
   * Sentry first, and deliberately BEFORE the dedupe below: the webhook is throttled to one
   * message a minute per route so a chat channel stays readable, and applying that same
   * throttle to the aggregator would hide exactly the thing an aggregator is for — that
   * this 500 has now happened four hundred times. No-op unless SENTRY_DSN is set.
   */
  if (!isHealthSignal(path, status)) {
    captureServerError(exception, { method, path, status });
  }

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return; // the chat tier is disabled

  const svc = serviceName();
  const errName = exception instanceof Error ? exception.name : 'UnknownError';
  const key = `${svc}|${method} ${path}|${errName}`;

  const now = Date.now();
  const last = lastSentAt.get(key) ?? 0;
  if (now - last < dedupeSeconds() * 1000) return; // throttled
  lastSentAt.set(key, now);
  // Keep the dedupe map from growing without bound on high-cardinality paths.
  if (lastSentAt.size > 500) lastSentAt.clear();

  const stack =
    exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
  const text = [
    `🚨 *${svc}* — HTTP ${status} on \`${method} ${path}\``,
    '```',
    redactAlertText(stack),
    '```',
  ].join('\n');

  // Never let alerting break the request path: no await, swallow every failure.
  // The timeout matters as much as the catch — a webhook host that accepts the
  // connection and never answers would otherwise hold a socket per 5xx.
  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}

/** `postgres://user:pass@host` → `postgres://***:***@host`. */
const CREDENTIALED_URL = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi;
/** `key=abc`, `"password": "abc"`, `x-internal-key: abc` — the value goes. */
const SECRET_ASSIGNMENT =
  /((?:api[_-]?key|secret|token|password|passwd|pwd|authorization|internal[_-]?key)["'\s]*[:=]\s*)(?:["']?)([^\s"',;)}]+)/gi;
/** A bare high-entropy blob (JWT segment, hex key, base64 secret) with no label. */
const OPAQUE_BLOB = /\b[A-Za-z0-9+_-]{32,}={0,2}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
/**
 * Indonesian mobile numbers, the PII most likely to sit in a domain error.
 * Deliberately narrow (`+628…` / `08…`): a looser digit-run pattern eats
 * timestamps and turns every alert into `[phone]`.
 */
const PHONE = /(?:\+62|\b0)8\d{7,11}\b/g;

const MAX_FRAMES = 6;
const MAX_CHARS = 1500;

/**
 * H-21: an unhandled 5xx stack goes to a third-party chat webhook — Slack or
 * Discord — which is outside the trust boundary and usually outside the country.
 * A stack is not just a code path: Prisma, Joi and fetch errors carry connection
 * strings, header values and the offending record's fields into `message`, and
 * every frame carries an absolute container path.
 *
 * So the alert keeps what makes it actionable (error name, message shape, the
 * first few frames) and drops what makes it a disclosure. Exported for the test —
 * the redaction is the point of this module, not an implementation detail.
 */
export function redactAlertText(raw: string): string {
  const frames = raw.split('\n').slice(0, MAX_FRAMES).join('\n');
  return (
    frames
      .replace(CREDENTIALED_URL, '$1***:***@')
      .replace(SECRET_ASSIGNMENT, '$1***')
      .replace(EMAIL, '[email]')
      .replace(PHONE, '[phone]')
      .replace(OPAQUE_BLOB, '[redacted]')
      // Absolute paths locate the deploy and leak the build layout; the frame is
      // just as readable relative to the workspace root.
      .replace(/(?:\/app\/|[A-Za-z]:\\|\/home\/[^/\s]+\/)/g, '')
      .slice(0, MAX_CHARS)
  );
}
