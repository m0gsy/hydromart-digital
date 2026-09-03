// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 's-1', role: 'STAFF_DEPOT' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/orders',
  useSearchParams: () => new URLSearchParams(),
}));

import { ConfirmProvider } from '@/components/confirm';
import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import { OrderDetail } from '@/components/dashboard/order-detail';
import type { Order } from '@/lib/types';

const ORDER = {
  id: 'o-1',
  orderNumber: 'HM-0001',
  status: 'PREPARING',
  depotId: 'd-1',
  customerId: 'c-1',
  recipientName: 'Wahyu',
  phone: '081234567890',
  addressLine: 'Jl. Mawar 1',
  city: 'Jakarta',
  province: 'DKI',
  postalCode: '12345',
  notes: 'Pagar hijau sebelah warung Bu Ani',
  deliveryWindow: '2026-08-22 09:00-12:00',
  subtotal: 20000,
  deliveryFee: 5000,
  discount: 0,
  total: 25000,
  items: [],
  history: [],
  reviewed: false,
  isWalkIn: false,
  driverName: null,
  driverPhone: null,
  estimatedArrivalAt: null,
  createdAt: '2026-08-20T03:00:00.000Z',
  updatedAt: '2026-08-20T03:00:00.000Z',
} as unknown as Order;

const draw = (order: Order) =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <ConfirmProvider>
          <OrderDetail order={order} onClose={() => {}} onChanged={() => {}} />
        </ConfirmProvider>
      </ToastProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

/**
 * B5. The customer picks a delivery window at checkout and is shown a confirmation of it.
 * order-service stores it on `orders.deliveryWindow` and returns it in its own response
 * DTO. Then it stopped: absent from the web `Order` type, absent from this sheet, absent
 * from the payload that creates the delivery.
 *
 * So the depot scheduling the run and the courier holding the box were both blind to a
 * choice the customer had already been promised — and nothing anywhere said so.
 */
describe('B5 — the delivery window on the screen that schedules the run', () => {
  it('shows the window the customer chose', () => {
    draw(ORDER);
    expect(screen.getByText(/09:00-12:00/)).toBeInTheDocument();
  });

  it('says nothing rather than inventing one when the order carried none', () => {
    draw({ ...ORDER, deliveryWindow: null } as Order);
    expect(screen.queryByText(/jendela antar|delivery window/i)).toBeNull();
  });

  it('still shows the landmark beside it — one did not replace the other', () => {
    draw(ORDER);
    expect(screen.getByText(/Pagar hijau sebelah warung Bu Ani/)).toBeInTheDocument();
  });
});
