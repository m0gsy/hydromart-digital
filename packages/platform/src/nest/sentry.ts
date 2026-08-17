import * as Sentry from '@sentry/node';

import { redactAlertText } from './error-alerter';

/**
 * PR-I. The chat webhook next door tells you THAT something broke, once per minute per
 * route, and forgets. It cannot tell you that the same 500 has happened four hundred times
 * since Tuesday's deploy, or which release started it — and that is the difference between
 * "we saw an alert" and "we know what is wrong".
 *
 * Sentry is that second tier, and it is entirely DSN-gated: with SENTRY_DSN blank — which
 * is every dev machine, every CI run and production until somebody puts a DSN in `.env` —
 * `init()` is never called and `captureServerError` returns immediately. Nothing phones
 * home by default.
 *
 * The redaction is the same function the webhook uses, wired as `beforeSend`. A stack is
 * not just a code path: Prisma, Joi and fetch errors carry connection strings, header
 * values and the offending record's fields in `message`, and a customer's phone number is
 * exactly the kind of thing that ends up in a domain error. Sentry is outside the trust
 * boundary in the same way a chat webhook is, so it gets the same treatment.
 */

let started = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || started) return;
  started = true;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // The image tag is what a deploy actually changes, so it is what "which release
    // started this" has to mean here.
    release: process.env.IMAGE_TAG || undefined,
    // Errors only. Tracing samples successful requests too, which is a bill and a
    // performance question nobody has asked for — turn it on deliberately, not by default.
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.message) event.message = redactAlertText(event.message);
      for (const value of event.exception?.values ?? []) {
        if (value.value) value.value = redactAlertText(value.value);
      }
      // A breadcrumb trail is a second copy of everything the request touched, with none
      // of the redaction above applied to it. Dropped rather than audited.
      event.breadcrumbs = [];
      return event;
    },
  });
}

/** Sends one 5xx to Sentry. No-op unless SENTRY_DSN is set. */
export function captureServerError(
  exception: unknown,
  context: { method: string; path: string; status: number },
): void {
  if (!process.env.SENTRY_DSN) return;
  initSentry();
  Sentry.withScope((scope) => {
    scope.setTag('http.method', context.method);
    scope.setTag('http.status', String(context.status));
    scope.setTransactionName(`${context.method} ${context.path}`);
    Sentry.captureException(exception);
  });
}
