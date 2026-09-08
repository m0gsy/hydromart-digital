// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three defects on one screen, all of which made the no-show gate lie to the courier
 * standing at the door.
 *
 *  - CA-4-28: the Chat button sent `'CHAT'`; delivery-service's `ContactMethod` is
 *    `CALL | WHATSAPP`, so class-validator rejected it with a 400 on every tap. The courier
 *    saw an error, the attempt was never recorded, and the gate counted none of them.
 *  - CA-4-30: the screen only ever learnt the state by POSTing an attempt, so an app that
 *    restarted mid-wait came back to "0 percobaan" and a fresh countdown — and the only way
 *    to see the truth again was to record an attempt they had not made.
 *  - CA-4-37: the unlock condition said `>= 2` against a per-depot setting, so a depot that
 *    asked for three attempts got a button that opened early and a server that then refused
 *    what the button had just offered.
 */

const { get, post, patch, replace } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) =>
      v ? `${k}:${Object.values(v).join('/')}` : k,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, back: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('id=del-1'),
  usePathname: () => '/driver/deliveries/detail/no-show',
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'del-1' }));
// DriverShell is the courier chrome (auth, nav, shift banner). Not what these tests are
// about, and it needs the whole provider tree to render.
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NoShowPage from '@/app/driver/deliveries/detail/no-show/page';

const LONG_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const status = (over: Partial<Record<string, unknown>> = {}) => ({
  attempts: 0,
  eligibleAt: null,
  canMarkNoShow: false,
  minAttempts: 2,
  ...over,
});

/*
 * CA-4-36: the screen now also reads the DELIVERY, for the customer's number — the two
 * contact controls open `tel:`/`wa.me` for real instead of only recording an attempt. So
 * the GET mock has to answer per URL; a blanket `status()` left the buttons inert, which
 * is the correct behaviour for a delivery with no number and the wrong fixture for these
 * tests.
 */
const DELIVERY = { id: 'd-1', orderNumber: 'HYD-1', recipientPhone: '081234567890' };

beforeEach(() => {
  localStorage.clear();
  get.mockImplementation(async (url: string) =>
    String(url).includes('contact-attempts') ? status() : DELIVERY,
  );
  post.mockResolvedValue(status({ attempts: 1 }));
  patch.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('CA-4-28 the Chat button', () => {
  it('sends the method delivery-service actually accepts', async () => {
    render(<NoShowPage />);
    // The control is an <a> now (CA-4-36): tapping it opens WhatsApp AND records the
    // attempt, rather than only recording one.
    await waitFor(() =>
      expect(screen.getByText('courierFix.noShow.chat').closest('a')).toBeTruthy(),
    );
    await userEvent.click(screen.getByText('courierFix.noShow.chat').closest('a')!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0]?.[1];
    expect(body).toEqual({ method: 'WHATSAPP' });
    // 'CHAT' is not in the server enum: sending it was a 400 on every tap.
    expect(JSON.stringify(body)).not.toContain('CHAT');
  });
});

describe('CA-4-30 the gate survives a restart', () => {
  it('reads the state on mount instead of only learning it by adding an attempt', async () => {
    get.mockResolvedValue(status({ attempts: 2, eligibleAt: LONG_AGO, canMarkNoShow: true }));
    render(<NoShowPage />);
    await waitFor(() =>
      expect(screen.getByText('courierFix.noShow.attemptsOf:2/2')).toBeTruthy(),
    );
    // Reading must not record: the count came back without a single POST.
    expect(post).not.toHaveBeenCalled();
    expect(
      screen.getByText('driver.noShow.markNoShow').closest('button')!.hasAttribute('disabled'),
    ).toBe(false);
  });

  it('brings back the contact log the courier already made on this phone', async () => {
    localStorage.setItem(
      'hydromart_noshow_log_del-1',
      JSON.stringify([{ method: 'CALL', at: Date.now() }]),
    );
    get.mockResolvedValue(status({ attempts: 1, eligibleAt: LONG_AGO }));
    render(<NoShowPage />);
    await waitFor(() => expect(screen.getByText(/courierFix.noShow.methodCall/)).toBeTruthy());
  });
});

describe('CA-4-37 the threshold is the depot own', () => {
  it('keeps the button shut at two attempts when the depot asks for three', async () => {
    get.mockResolvedValue(
      status({ attempts: 2, eligibleAt: LONG_AGO, canMarkNoShow: false, minAttempts: 3 }),
    );
    render(<NoShowPage />);
    await waitFor(() =>
      expect(screen.getByText('courierFix.noShow.attemptsOf:2/3')).toBeTruthy(),
    );
    // The old `>= 2` would have opened here, and the server would then have refused it.
    expect(
      screen.getByText('driver.noShow.markNoShow').closest('button')!.hasAttribute('disabled'),
    ).toBe(true);
  });

  it('opens at the depot threshold once the wait has elapsed', async () => {
    get.mockResolvedValue(
      status({ attempts: 3, eligibleAt: LONG_AGO, canMarkNoShow: false, minAttempts: 3 }),
    );
    render(<NoShowPage />);
    await waitFor(() =>
      expect(
        screen.getByText('driver.noShow.markNoShow').closest('button')!.hasAttribute('disabled'),
      ).toBe(false),
    );
  });
});
