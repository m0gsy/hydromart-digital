// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-69, the screens that answered a question they had not been asked.
 *
 *  - The HQ returns table printed `r.circulating` under TWO different headings: "Galon
 *    beredar" and "Belum kembali". They are the same fact — issued minus returned — so the
 *    table invented a second number by giving one a second name.
 *  - That page fanned out one request per depot with `Promise.all`, so a single depot that
 *    could not be read turned the whole network view into an error: the screen disappeared
 *    exactly when part of the network was in trouble.
 *  - The depot detail caught a failed staff read to `{ items: [] }`, so a depot with a full
 *    roster read as "belum ada staf" whenever auth-service was slow.
 */
const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get, getCached }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/returns',
  useSearchParams: () => new URLSearchParams(),
}));

import HqReturnsPage from '@/app/hq/returns/page';

const DEPOTS = {
  items: [
    { id: 'd1', name: 'Depot Satu', code: 'JKT-01', active: true },
    { id: 'd2', name: 'Depot Dua', code: 'JKT-02', active: true },
  ],
  total: 2,
  page: 1,
  limit: 100,
};

beforeEach(() => {
  get.mockReset();
  getCached.mockReset();
  getCached.mockResolvedValue(DEPOTS);
});

describe('HQ returns table (CA-2-69)', () => {
  it('shows the circulating figure once, not under two headings', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('/returns/')
        ? { gallons: 40, damaged: 0, depositRefunded: 100_000 }
        : { gallons: 100, depositHeld: 500_000 },
    );

    const { container } = render(<HqReturnsPage />);

    await waitFor(() => expect(screen.getByText('Depot Satu')).toBeTruthy());
    // circulating = 100 issued − 40 returned = 60, printed ONCE per depot row.
    const sixties = Array.from(container.querySelectorAll('td')).filter(
      (td) => td.textContent?.trim() === '60',
    );
    expect(sixties).toHaveLength(DEPOTS.items.length);
  });

  /*
   * The depots that answered are shown, and the ones that did not are NAMED. Quietly
   * rendering fewer rows would be worse than the error it replaces: the totals under the
   * table would be short by an unknown amount and read as a healthier network.
   */
  it('keeps the readable depots when one fails, and names the one that did not', async () => {
    get.mockImplementation(async (url: string) => {
      if (String(url).includes('d2')) throw new Error('depot-service timed out');
      return String(url).includes('/returns/')
        ? { gallons: 40, damaged: 0, depositRefunded: 100_000 }
        : { gallons: 100, depositHeld: 500_000 };
    });

    render(<HqReturnsPage />);

    await waitFor(() => expect(screen.getByText('Depot Satu')).toBeTruthy());
    expect(screen.queryByText('Depot Dua')).toBeNull();
    expect(screen.getByText(/hq\.returns\.partial/)).toBeTruthy();
  });

  it('still reports a total failure as an error rather than an empty network', async () => {
    getCached.mockRejectedValue(new Error('depot directory unreachable'));

    render(<HqReturnsPage />);

    await waitFor(() => expect(screen.queryByText('Depot Satu')).toBeNull());
  });
});

/**
 * CA-2-69: the network stock page, and the same all-or-nothing fan-out the returns table
 * had. This is the screen whose entire job is to say which depot needs restocking, so it
 * disappearing when one depot is unreachable is the worst possible time for it to go.
 */
describe('HQ network stock (CA-2-69)', () => {
  it('keeps the readable depots when one fails, and names the one that did not', async () => {
    getCached.mockResolvedValue(DEPOTS);
    get.mockImplementation(async (url: string) => {
      if (String(url).includes('d2')) throw new Error('depot-service timed out');
      return [{ id: 'i1', label: 'Galon', lowStock: true }];
    });

    const HqInventoryPage = (await import('@/app/hq/inventory/page')).default;
    render(<HqInventoryPage />);

    await waitFor(() => expect(screen.getByText('Depot Satu')).toBeTruthy());
    expect(screen.queryByText('Depot Dua')).toBeNull();
    // Counting "Kritis" over a slice is the same mistake CA-2-26 fixed; saying which depots
    // are missing is what stops the number being read as the whole network.
    expect(screen.getByText(/hq\.inventory\.partial/)).toBeTruthy();
  });
});
