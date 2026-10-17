// @vitest-environment jsdom
/**
 * FR-034 / FR-036 / FR-052 on the order screen: the PPN already inside the total, the booked
 * delivery time, and the door to move it — which exists only while the order can still be moved.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached, post }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'o-1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/orders/detail',
  useSearchParams: () => new URLSearchParams('id=o-1'),
}));

import OrderDetailPage from '@/app/orders/detail/page';
import { ToastProvider } from '@/components/toast';
import { LocaleProvider } from '@/lib/locale-context';

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o-1',
  orderNumber: 'HM-0001',
  status: 'CREATED',
  depotId: 'd-1',
  recipientName: 'Wahyu',
  phone: '081234567890',
  addressLine: 'Jl. Mawar 1',
  subtotal: 20000,
  deliveryFee: 5000,
  discount: 0,
  total: 25000,
  items: [
    { productId: 'p-1', productName: 'Galon 19L', quantity: 1, unitPrice: 20000, lineTotal: 20000 },
  ],
  history: [{ status: 'CREATED', createdAt: '2026-08-20T03:00:00.000Z' }],
  reviewed: false,
  deliveryWindow: '09.00-11.00',
  scheduledFor: '2026-09-01T02:00:00.000Z',
  taxAmount: 2477,
  taxPercent: 11,
  createdAt: '2026-08-20T03:00:00.000Z',
  ...over,
});

function mockOrder(over: Record<string, unknown> = {}) {
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/orders/o-1')) return Promise.resolve(order(over));
    if (p.includes('/contact')) return Promise.resolve({ name: 'Depot', contactPhone: null });
    if (p.includes('/payment-info')) return Promise.resolve(null);
    if (p.includes('/payments')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve(null);
  });
}

const show = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <OrderDetailPage />
      </ToastProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  getCached.mockReset().mockResolvedValue(null);
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('order screen: PPN and booked time', () => {
  it('says how much of the total is PPN, without adding it to the total', async () => {
    mockOrder();
    show();
    await waitFor(() => expect(screen.getByText('Sudah termasuk PPN 11%')).toBeTruthy());
    expect(screen.getByText(/2\.477/)).toBeTruthy();
  });

  it('shows no PPN line for an order that recorded none', async () => {
    mockOrder({ taxAmount: 0, taxPercent: null });
    show();
    await waitFor(() =>
      expect(screen.getAllByText('HM-0001', { exact: false }).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/Sudah termasuk PPN/)).toBeNull();
  });

  it('prints the booked day and time in Jakarta time', async () => {
    mockOrder();
    show();
    await waitFor(() => expect(screen.getByText(/Jadwal antar:/)).toBeTruthy());
    expect(screen.getByText(/Jadwal antar:.*09[.:]00/)).toBeTruthy();
  });
});

describe('order screen: the reschedule door', () => {
  it('is offered for a scheduled order that has not left the depot', async () => {
    mockOrder();
    show();
    await waitFor(() => expect(screen.getByText('Jadwalkan ulang')).toBeTruthy());
  });

  it('is not offered for an express order: it has no slot', async () => {
    mockOrder({ deliveryWindow: 'Antar sekarang (express)', scheduledFor: null });
    show();
    await waitFor(() =>
      expect(screen.getAllByText('HM-0001', { exact: false }).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('Jadwalkan ulang')).toBeNull();
  });

  it('is not offered once a courier has been assigned', async () => {
    mockOrder({ status: 'DRIVER_ASSIGNED' });
    show();
    await waitFor(() =>
      expect(screen.getAllByText('HM-0001', { exact: false }).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('Jadwalkan ulang')).toBeNull();
  });
});
