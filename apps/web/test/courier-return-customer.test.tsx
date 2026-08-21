// @vitest-environment jsdom
/**
 * I3 · a courier return was recorded against nobody.
 *
 * The screen posts `depotId, orderId, quantity, condition` and stops there, so every
 * courier-collected empty landed with `customerId: null`. There was no per-customer deposit
 * balance to reconcile at all — and once I2 made the return cap per-customer, a nameless
 * return could not be measured against the person who actually holds the deposit.
 *
 * The id was never missing: delivery-service snapshots `customerId` on the delivery and
 * `getForDriver` returns the whole record. The screen simply never read it.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/driver/deliveries/detail/returns',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'drv-1', role: 'DRIVER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post } };
});
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'del-1' }));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { LocaleProvider } from '@/lib/locale-context';
import ReturnsPage from '@/app/driver/deliveries/detail/returns/page';

const DELIVERY = {
  id: 'del-1',
  orderId: 'ord-1',
  orderNumber: 'HM-1001',
  driverId: 'drv-1',
  depotId: 'depot-1',
  // Snapshotted at assignment. The screen has always been handed this.
  customerId: 'cust-7',
  status: 'DELIVERED',
  destinationAddress: 'Jl. Merdeka 10',
  destinationLat: null,
  destinationLng: null,
  lastLat: null,
  lastLng: null,
  lastLocationAt: null,
  assignedAt: '2026-08-20T01:00:00Z',
};

beforeEach(() => {
  get.mockReset().mockResolvedValue(DELIVERY);
  post.mockReset().mockResolvedValue({
    id: 'gr-1',
    quantity: 1,
    condition: 'GOOD',
    depositRefunded: 20000,
  });
});
afterEach(() => vi.clearAllMocks());

describe('I3 · a courier return names the customer it belongs to', () => {
  it('sends the customer id the delivery already carries', async () => {
    render(<ReturnsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('HM-1001')).toBeTruthy());

    const submit = screen.getByRole('button', { name: /Simpan|Catat|Kirim/i });
    await userEvent.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({
      depotId: 'depot-1',
      orderId: 'ord-1',
      customerId: 'cust-7',
    });
  });

  // A legacy delivery predates the snapshot and carries no customer. The key must be
  // OMITTED rather than sent as null: the DTO reads absent as "anonymous", and a null
  // would have to be special-cased there — the same shape C9 settled for the counter.
  it('omits the key entirely when the delivery predates the snapshot', async () => {
    get.mockResolvedValue({ ...DELIVERY, customerId: null });
    render(<ReturnsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('HM-1001')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /Simpan|Catat|Kirim/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect('customerId' in (post.mock.calls[0]![1] as object)).toBe(false);
  });
});
