// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-61: two global searches that did not search their own console's main object.
 *
 * The depot console searched depots, products and a customer by phone — everything except
 * the ORDER, which is the thing the console exists to work on. A staff member holding the
 * order number a customer had just read out over the phone got "Tidak ada hasil".
 *
 * Head office searched depots, staff and orders — and could not find a CUSTOMER at all,
 * although the depot console found the same account through the same endpoint.
 *
 * Both assert the URL that was never called. Revert either fix and the matching test goes
 * red, because the request simply is not made.
 */
const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get, getCached }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import DepotSearchPage from '@/app/dashboard/search/page';
import HqSearchPage from '@/app/hq/search/page';

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 10 });

/** Every URL either api method was asked for, in order. */
const urls = () => [...get.mock.calls, ...getCached.mock.calls].map((c) => String(c[0]));

beforeEach(() => {
  get.mockReset();
  getCached.mockReset();
  get.mockResolvedValue(page([]));
  getCached.mockResolvedValue(page([]));
});

describe('depot console search (CA-2-61)', () => {
  it('searches orders by number, and shows what it finds', async () => {
    get.mockImplementation(async (url: string) =>
      url.includes('/orders/manage')
        ? page([{ id: 'o1', orderNumber: 'HM-240101-0007', status: 'DELIVERED', total: 42000 }])
        : page([]),
    );

    render(<DepotSearchPage />);
    fireEvent.change(screen.getByPlaceholderText('dashC.search.placeholder'), {
      target: { value: 'HM-240101-0007' },
    });
    fireEvent.submit(screen.getByPlaceholderText('dashC.search.placeholder').closest('form')!);

    await waitFor(() => expect(screen.getByText('HM-240101-0007')).toBeTruthy());
    expect(urls().some((u) => u.includes('orderNumber=HM-240101-0007'))).toBe(true);
  });
});

describe('head-office search (CA-2-61)', () => {
  it('finds a customer by phone, through the lookup the depot console already used', async () => {
    get.mockImplementation(async (url: string) =>
      url.includes('/customers/lookup')
        ? { id: 'c1', fullName: 'Budi', phone: '+628123456789' }
        : page([]),
    );

    render(<HqSearchPage />);
    fireEvent.change(screen.getByPlaceholderText('hq.search.placeholder'), {
      target: { value: '+628123456789' },
    });

    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy(), { timeout: 3000 });
    expect(urls().some((u) => u.includes('lookup'))).toBe(true);
  });

  /*
   * Most search terms are not phone numbers. A lookup that 404s on "budi" must not be
   * reported as "customers could not be searched" — the partial-results banner exists for
   * a source that is DOWN, and crying wolf on every ordinary word retires it.
   */
  it('does not call the lookup, or claim a failure, for a non-phone term', async () => {
    render(<HqSearchPage />);
    fireEvent.change(screen.getByPlaceholderText('hq.search.placeholder'), {
      target: { value: 'budi' },
    });

    await waitFor(() => expect(urls().some((u) => u.includes('/depots'))).toBe(true), {
      timeout: 3000,
    });
    expect(urls().some((u) => u.includes('lookup'))).toBe(false);
    expect(screen.queryByText('hq.search.partial')).toBeNull();
  });
});
