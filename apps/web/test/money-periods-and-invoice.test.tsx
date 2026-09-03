// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-63, the console half.
 *
 *  - The invoice was built from `order.subtotal` — the goods alone. Delivery fee and
 *    discount were both missing, so the printed total was a number the customer never
 *    paid: lower than the bill on a delivered order, higher on a discounted one.
 *  - It stamped LUNAS unconditionally, on whatever the preview loaded — and the preview
 *    loads the NEWEST order, the one least likely to be paid.
 *  - The profit-and-loss report could only ever show the current month, and computed that
 *    month from UTC. Jakarta is UTC+7, so before 07:00 on the first it asked for the
 *    previous month under a heading naming this one.
 */
const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get, getCached }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'MANAGER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd1', name: 'Depot Cikini', code: 'JKT-01' }],
    selectedId: 'd1',
    selected: { id: 'd1', name: 'Depot Cikini', code: 'JKT-01' },
    scopedId: 'd1',
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/invoice-template',
  useSearchParams: () => new URLSearchParams(),
}));

import InvoiceTemplatePage from '@/app/hq/invoice-template/page';
import MonthlyPnlPage from '@/app/dashboard/monthly-pnl/page';

const TAX = {
  ppnPercent: 11,
  priceIncludesTax: false,
  companyName: 'PT Hydromart',
  npwp: '',
  address: '',
  invoiceFormat: 'INV/{YYYY}/{MM}/{SEQ}',
  taxRounding: 'HALF_UP',
};

/** subtotal 100.000 + ongkir 15.000 − diskon 5.000 = 110.000 actually charged. */
const ORDER = {
  id: 'o1',
  orderNumber: 'HM-260901-0001',
  customerId: 'c1',
  depotId: 'd1',
  status: 'DELIVERED',
  subtotal: 100_000,
  deliveryFee: 15_000,
  discount: 5_000,
  total: 110_000,
  items: [],
  history: [],
  reviewed: false,
  isWalkIn: false,
  createdAt: '2026-09-01T02:00:00.000Z',
};

beforeEach(() => {
  get.mockReset();
  getCached.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('invoice (CA-2-63)', () => {
  const route = (payment: unknown) => async (url: string) => {
    if (String(url).includes('/tax')) return TAX;
    if (String(url).includes('for-order')) {
      if (payment === null) throw new Error('no payment');
      return payment;
    }
    return { items: [ORDER], total: 1, page: 1, limit: 1 };
  };

  it('invoices what was charged, not the goods subtotal', async () => {
    get.mockImplementation(route({ id: 'p1', orderId: 'o1', status: 'PAID', amount: 110_000 }));
    render(<InvoiceTemplatePage />);

    // 110.000 is what the customer paid. 100.000 is the number this screen used to print.
    await waitFor(() => expect(screen.getAllByText(/110\.000/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/^Rp\s*100\.000$/)).toBeNull();
  });

  /*
   * The stamp is the point: an invoice template that always certifies payment is one that
   * certifies payment it knows nothing about, and this screen is what the real invoice is
   * printed from.
   */
  it('does not stamp LUNAS on an order that has not been paid', async () => {
    get.mockImplementation(route({ id: 'p1', orderId: 'o1', status: 'PENDING', amount: 110_000 }));
    render(<InvoiceTemplatePage />);

    await waitFor(() => expect(screen.getByText(/invoiceTemplate\.unpaid/)).toBeTruthy());
    expect(screen.queryByText('hq.invoiceTemplate.paid')).toBeNull();
  });

  it('says the status could not be read rather than claiming paid', async () => {
    get.mockImplementation(route(null));
    render(<InvoiceTemplatePage />);

    await waitFor(() => expect(screen.getByText(/invoiceTemplate\.unpaid/)).toBeTruthy());
  });
});

describe('profit and loss (CA-2-63)', () => {
  it('asks for the month in Jakarta time, not UTC', async () => {
    // 01 September 2026, 02:00 UTC — which is 09:00 on the 1st in Jakarta, but whose
    // `toISOString()` month is still 2026-09 … so pick an hour where they DISAGREE:
    // 31 August 21:00 UTC is already 1 September in Jakarta.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-31T21:00:00.000Z'));
    get.mockResolvedValue(null);

    render(<MonthlyPnlPage />);

    await waitFor(() => expect(get).toHaveBeenCalled());
    const urls = get.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('2026-09'))).toBe(true);
    expect(urls.some((u) => u.includes('2026-08'))).toBe(false);
  });

  it('can look back at a month that has already ended', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-15T05:00:00.000Z'));
    get.mockResolvedValue(null);

    render(<MonthlyPnlPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    const picker = screen.getByLabelText('mgrFix.pnl.monthLabel');
    fireEvent.change(picker, { target: { value: '2026-07' } });

    await waitFor(() =>
      expect(get.mock.calls.map((c) => String(c[0])).some((u) => u.includes('2026-07'))).toBe(true),
    );
  });
});
