// @vitest-environment jsdom
/*
 * CA-2-11 — the platform fee read 0% for every role that could not read the settings.
 *
 * The paragraph in the source already said what should happen: a role that cannot ask sees
 * `—`. The code did something else. When `maySeeSettings` is false the fetcher resolves to
 * `{}` — not an error, not loading — so `?? 0` made the fee read 0%, and the NET below it
 * was computed as though the platform took nothing. A DIREKTUR reading the statement got a
 * number that was wrong by the whole fee, with nothing marking it.
 *
 * Unknown is not zero.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, role } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  role: { current: 'SUPER_ADMIN' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/reconciliation',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import HqReconciliationPage from '@/app/hq/reconciliation/page';

const ROLLUP = {
  depots: [
    {
      depotId: 'd-1',
      depotName: 'Depot Satu',
      revenue: 10_000_000,
      commissionBase: 9_000_000,
      orders: 100,
    },
  ],
};

beforeEach(() => {
  role.current = 'SUPER_ADMIN';
  const answer = (url: string) => {
    const u = String(url);
    if (u.includes('/rollup') || u.includes('/network')) return Promise.resolve(ROLLUP);
    // Order matters: the commission schemes live under /payout/api/v1 too, and they are a
    // LIST. Matching the settings prefix first hands the list an object and crashes.
    if (u.includes('/settings/schema'))
      return Promise.resolve({ effective: { platformFeePct: 5 } });
    // Everything else on this page is a LIST; handing one an object shape crashes the
    // render before the fee row is ever drawn.
    // Two of the reports answer with `{ items: [...] }` and the rest with plain arrays.
    // Handing either the other shape crashes the render before the fee row is drawn.
    if (u.includes('shipping') || u.includes('refunds')) return Promise.resolve({ items: [] });
    return Promise.resolve([]);
  };
  get.mockReset().mockImplementation(answer);
  getCached.mockReset().mockImplementation(answer);
});
afterEach(() => vi.clearAllMocks());

describe('the platform fee is a number or a dash, never a silent zero (CA-2-11)', () => {
  it('shows the real percentage to a role that may read the settings', async () => {
    render(<HqReconciliationPage />, { wrapper: LocaleProvider });

    await waitFor(() =>
      expect(screen.getAllByText(/Biaya platform \(5%\)/).length).toBeGreaterThan(0),
    );
    // Never the 0% that used to stand in for "not allowed to ask".
    expect(screen.queryByText(/Biaya platform \(0%\)/)).toBeNull();
  });

  it('shows no percentage at all to a role that may not', async () => {
    // DIREKTUR reads the statement; the fee editor behind `depotAdmin` is not theirs.
    role.current = 'DIREKTUR';

    render(<HqReconciliationPage />, { wrapper: LocaleProvider });

    await waitFor(() => expect(screen.getAllByText(/Biaya platform/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Biaya platform \(0%\)/)).toBeNull();
    expect(screen.queryByText(/Biaya platform \(\d+%\)/)).toBeNull();
  });
});
