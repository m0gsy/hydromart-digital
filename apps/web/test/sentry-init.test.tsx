// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn();
vi.mock('@sentry/nextjs', () => ({ init }));

import { SentryInit } from '@/components/sentry-init';

/** The beforeSend the component handed to Sentry.init. */
const beforeSend = () => init.mock.calls[0][0].beforeSend as (e: Record<string, unknown>) => unknown;

describe('SentryInit', () => {
  afterEach(() => {
    init.mockClear();
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it('stays out of the way entirely without a DSN', async () => {
    render(<SentryInit />);
    await Promise.resolve();
    expect(init).not.toHaveBeenCalled();
  });

  it('initialises when a DSN is configured', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key@sentry.example/2';
    render(<SentryInit />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    expect(init.mock.calls[0][0]).toMatchObject({ tracesSampleRate: 0 });
  });

  describe('beforeSend', () => {
    it('drops breadcrumbs and the query string — both carry the customer', async () => {
      process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key@sentry.example/2';
      render(<SentryInit />);
      await waitFor(() => expect(init).toHaveBeenCalled());
      const event = beforeSend()({
        breadcrumbs: [{ message: 'typed +628123456789' }],
        request: { url: 'https://app.hydromart.id/orders?phone=%2B628123456789' },
      }) as { breadcrumbs: unknown[]; request: { url: string } };
      expect(event.breadcrumbs).toEqual([]);
      expect(event.request.url).toBe('https://app.hydromart.id/orders');
    });

    it('leaves an event with no request alone', async () => {
      process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key@sentry.example/2';
      render(<SentryInit />);
      await waitFor(() => expect(init).toHaveBeenCalled());
      expect(beforeSend()({})).toEqual({ breadcrumbs: [] });
    });
  });
});
