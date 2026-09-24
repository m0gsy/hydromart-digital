import { describe, expect, it } from 'vitest';

import { sentryOptions } from '@/lib/sentry-options';

/*
 * WEBA-1. There were two initialisation paths and only one of them scrubbed. `SentryInit`
 * set `sendDefaultPii: false`, emptied the breadcrumb trail and stripped the query string;
 * the global-error boundary — which initialises the client itself, precisely because the
 * root layout where `SentryInit` lives may have failed before it ran — passed three options
 * and none of the rest. The events most likely to be sent from a broken screen were the ones
 * sent with the least care.
 */
describe('sentryOptions (WEBA-1)', () => {
  const options = () => sentryOptions('https://key@sentry.example/2');

  it('never attaches the PII the SDK default might', () => {
    expect(options()).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0 });
  });

  it('drops breadcrumbs and the query string — both carry the customer', () => {
    const beforeSend = options().beforeSend as (e: unknown) => unknown;
    const event = beforeSend({
      breadcrumbs: [{ message: 'typed +628123456789' }],
      request: { url: 'https://app.hydromart.id/orders?phone=%2B628123456789' },
    }) as { breadcrumbs: unknown[]; request: { url: string } };

    expect(event.breadcrumbs).toEqual([]);
    expect(event.request.url).toBe('https://app.hydromart.id/orders');
  });

  it('leaves an event with no request alone', () => {
    const beforeSend = options().beforeSend as (e: unknown) => unknown;
    expect(beforeSend({})).toEqual({ breadcrumbs: [] });
  });
});
