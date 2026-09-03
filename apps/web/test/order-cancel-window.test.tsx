// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
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

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import OrderDetailPage from '@/app/orders/detail/page';

const order = (status: string) => ({
  id: 'o-1',
  orderNumber: 'HM-0001',
  status,
  depotId: 'd-1',
  recipientName: 'Wahyu',
  phone: '081234567890',
  addressLine: 'Jl. Mawar 1',
  subtotal: 20000,
  deliveryFee: 5000,
  discountAmount: 0,
  totalAmount: 25000,
  paymentMethod: 'CASH',
  items: [
    { productId: 'p-1', productName: 'Galon 19L', quantity: 1, unitPrice: 20000, lineTotal: 20000 },
  ],
  history: [],
  reviewed: false,
  createdAt: '2026-08-20T03:00:00.000Z',
});

function mockOrder(status: string, contactPhone: string | null = '081298765432') {
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/orders/o-1')) return Promise.resolve(order(status));
    if (p.includes('/contact')) return Promise.resolve({ name: 'Depot Kemang', contactPhone });
    if (p.includes('/payment-info')) return Promise.resolve(null);
    if (p.includes('/payments')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve(null);
  });
}

const renderPage = () =>
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

/**
 * H10. BR-006 lets a customer cancel only before a driver is assigned, and the button
 * simply DISAPPEARED at that moment — no line saying why, and nothing offered in its
 * place. From the customer's side the app forgot the order could be cancelled at all, on
 * the exact screen where they had gone looking for it, at the exact moment a mistake
 * becomes expensive.
 *
 * The rule is not being changed. What is added is the sentence that names it and the door
 * it leaves open: the depot, which can still stop the run.
 */
describe('H10 — the window in which an order can still be cancelled', () => {
  it.each(['CREATED', 'CONFIRMED', 'PREPARING'])(
    '%s still offers the cancel button',
    async (status) => {
      mockOrder(status);
      renderPage();
      expect(
        await screen.findByRole('button', { name: /batalkan pesanan|cancel order/i }),
      ).toBeInTheDocument();
    },
  );

  it('says why the button is gone once a courier is on the way', async () => {
    mockOrder('DRIVER_ASSIGNED');
    renderPage();

    await screen.findAllByText(/HM-0001/);
    expect(screen.queryByRole('button', { name: /batalkan pesanan|cancel order/i })).toBeNull();
    expect(
      await screen.findByText(/kurir sudah ditugaskan|courier has been assigned/i),
    ).toBeInTheDocument();
  });

  it('offers the depot as the way out, with its real number', async () => {
    mockOrder('DRIVER_ASSIGNED');
    renderPage();

    const call = await screen.findByRole('link', { name: /hubungi depot|contact the depot/i });
    expect(call.getAttribute('href')).toContain('081298765432');
  });

  it('offers no call to nobody when the depot never filled in a number', async () => {
    mockOrder('DRIVER_ASSIGNED', null);
    renderPage();

    await screen.findByText(/kurir sudah ditugaskan|courier has been assigned/i);
    expect(screen.queryByRole('link', { name: /hubungi depot|contact the depot/i })).toBeNull();
  });

  it('says nothing at all once the order is finished', async () => {
    mockOrder('COMPLETED');
    renderPage();

    await screen.findAllByText(/HM-0001/);
    expect(screen.queryByText(/kurir sudah ditugaskan|courier has been assigned/i)).toBeNull();
  });
});

/*
 * K2.4 — the window REOPENS after a failed attempt. A reschedule hands the order back to
 * the dispatch queue on PREPARING, and BR-006 reads the status alone: an order whose goods
 * already left the depot, rode around and came back offers its cancel button again — and
 * cancelling releases a stock hold on goods that have physically moved.
 */
describe('K2.4 · a second attempt does not reopen the cancel window', () => {
  const withHistory = (status: string, history: string[]) => {
    get.mockReset().mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/orders/o-1'))
        return Promise.resolve({
          ...order(status),
          history: history.map((s, i) => ({
            status: s,
            note: null,
            createdAt: `2026-08-2${i}T03:00:00.000Z`,
          })),
        });
      if (p.includes('/contact'))
        return Promise.resolve({ name: 'Depot Kemang', contactPhone: '081298765432' });
      if (p.includes('/payment-info')) return Promise.resolve(null);
      if (p.includes('/payments')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve(null);
    });
  };

  it('still offers cancel on an order that never left the depot', async () => {
    withHistory('PREPARING', ['CREATED', 'CONFIRMED', 'PREPARING']);
    renderPage();
    expect(await screen.findByRole('button', { name: /batalkan/i })).toBeTruthy();
  });

  it('withholds it once the order has been out with a courier, even back on PREPARING', async () => {
    withHistory('PREPARING', [
      'CREATED',
      'CONFIRMED',
      'PREPARING',
      'DRIVER_ASSIGNED',
      'ON_DELIVERY',
      'PREPARING',
    ]);
    renderPage();
    // The depot line — the one H10 added for exactly this situation — takes its place.
    await screen.findAllByText(/depot/i);
    expect(screen.queryByRole('button', { name: /batalkan/i })).toBeNull();
  });
});
