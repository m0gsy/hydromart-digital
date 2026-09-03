// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * O9 — the reconciliation screen names a problem and offers no way out of it.
 *
 * Every row that says "Menunggu" is a payment somebody has to confirm, and the button that
 * confirms it lives on the order, one screen away, with no link between them. Worse, two
 * roles (SUPERVISOR, DIREKTUR) hold `depotFinance` and NOT `paymentSettle`: they can open
 * this screen and can never act on a single row of it, and nothing on the screen says so.
 *
 * So: a row is a link to its order for the roles that may settle, and for the roles that
 * may not the screen states it is read-only instead of handing them a link into a 403.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const role = vi.hoisted(() => ({ current: 'MANAGER' }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current } }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/payment-recon',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-a',
    selectedId: 'depot-a',
    selected: { id: 'depot-a', name: 'Depot A', code: 'DPT-A' },
    depots: [{ id: 'depot-a', name: 'Depot A', code: 'DPT-A' }],
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));

import { LocaleProvider } from '@/lib/locale-context';
import PaymentReconPage from '@/app/dashboard/payment-recon/page';

const order = {
  id: 'o-1',
  orderNumber: 'HM-260816-001',
  recipientName: 'Ibu Rina',
  total: 57000,
  customerId: 'c-1',
  depotId: 'depot-a',
  status: 'DELIVERED',
};

beforeEach(() => {
  role.current = 'MANAGER';
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ items: [order], total: 1, page: 1, limit: 20 });
  post.mockResolvedValue([
    { id: 'p-1', orderId: 'o-1', method: 'CASH', status: 'PENDING', amount: 57000 },
  ]);
});
afterEach(() => vi.clearAllMocks());

const view = () =>
  render(
    <LocaleProvider>
      <PaymentReconPage />
    </LocaleProvider>,
  );

describe('reconciliation rows have a way out', () => {
  it('links a row to its order for a role that may settle payments', async () => {
    view();
    const row = await screen.findByText(/HM-260816-001 · Ibu Rina/);
    const link = row.closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/dashboard/orders?order=o-1');
  });

  it('says it is read-only, and links nowhere, for a role that may not', async () => {
    role.current = 'SUPERVISOR';
    view();
    const row = await screen.findByText(/HM-260816-001 · Ibu Rina/);
    expect(row.closest('a')).toBeNull();
    expect(screen.getByText(/baca-saja|hanya bisa dilihat/i)).toBeTruthy();
  });

  it('says which kind of waiting this is — payment, not verification', async () => {
    view();
    await screen.findByText(/HM-260816-001 · Ibu Rina/);
    expect(screen.getByText(/Menunggu pembayaran/)).toBeTruthy();
  });
});
