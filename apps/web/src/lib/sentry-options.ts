/**
 * WEBA-1 — one Sentry configuration, for every path that initialises it.
 *
 * There were two. `SentryInit` set `sendDefaultPii: false`, emptied the breadcrumb trail and
 * stripped the query string; the global-error boundary — which initialises the client itself,
 * precisely because the root layout (where `SentryInit` lives) may have failed before it ran
 * — called `Sentry.init({ dsn, environment, tracesSampleRate })` and none of the rest. So the
 * events most likely to be sent from a broken screen were the ones sent with the least
 * scrubbing: breadcrumbs intact, query string intact, PII defaults whatever the installed SDK
 * major happens to use.
 *
 * Two copies of a privacy decision is one copy too many. The rule lives here now, and both
 * callers pass through it.
 */
export interface SentryEventShape {
  breadcrumbs?: unknown[];
  request?: { url?: string };
}

export function sentryOptions(dsn: string): Record<string, unknown> {
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    tracesSampleRate: 0,
    /*
     * Explicit, not left to the SDK default. `sendDefaultPii` is what attaches the IP
     * address, cookies and headers to an event, and the default has changed between major
     * versions of this SDK before. On a screen carrying a customer's name and address, the
     * difference between the default and the intent is the whole question, and a reader of
     * this file should not have to know which version is installed.
     *
     * This is the client half. Sentry still SEES the request IP because it is the peer
     * address of the upload — turning that off is a project setting (Security & Privacy ->
     * Prevent Storing of IP Addresses), not something code can do.
     */
    sendDefaultPii: false,
    // The customer's own screen is full of their name, address and phone. A replay or a
    // breadcrumb trail carries all of it to a third party, so neither is enabled and
    // breadcrumbs are dropped on the way out — the same rule the backend alerter follows.
    beforeSend(event: SentryEventShape) {
      event.breadcrumbs = [];
      if (event.request?.url) {
        // A query string carries phone numbers and ids on the search screens.
        event.request.url = event.request.url.split('?')[0];
      }
      return event;
    },
  };
}
