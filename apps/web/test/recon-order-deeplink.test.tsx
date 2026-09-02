// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * O9, second half — the reconciliation row links to `/dashboard/orders?order=<id>`, and a
 * link is only an exit if the queue opens that order on arrival. The order detail was
 * client state with no address at all, and the queue reads the OPEN backlog only, so a
 * settled-but-unpaid order is frequently not in the list it renders: the id is fetched
 * (`manage/:id`, `orderQueue`) rather than looked up in the page it happened to load.
 */

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
const params = vi.hoisted(() => ({ current: new URLSearchParams() }));

vi.mock('@/lib/api', () => ({ api: { get, post, patch }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 's-1', role: 'STAFF_DEPOT' }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ selectedId: 'd-1', selected: { id: 'd-1', name: 'Depot Kemang', code: 'KMG' }, depots: [] }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/orders',
  useSearchParams: () => params.current,
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ConfirmProvider } from '@/components/confirm';
import { ToastProvider } from '@/components/toast';
import OrdersQueuePage from '@/app/dashboard/orders/page';

const REQUESTED = {
  id: 'o-far',
  orderNumber: 'HM-260816-777',
  status: 'COMPLETED',
  depotId: 'd-1',
  customerId: 'c-1',
  recipientName: 'Ibu Rina',
  phone: '0811',
  addressLine: 'Jl. Mawar 1',
  city: 'Jakarta',
  subtotal: 52000,
  deliveryFee: 5000,
  discount: 0,
  total: 57000,
  items: [],
  history: [],
  createdAt: '2026-08-20T03:00:00.000Z',
};

beforeEach(() => {
  params.current = new URLSearchParams();
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/orders/manage/o-far')) return Promise.resolve(REQUESTED);
    if (p.includes('/orders')) return Promise.resolve({ items: [], total: 0 });
    if (p.includes('/deliveries')) return Promise.resolve({ items: [], total: 0 });
    if (p.includes('/drivers')) return Promise.resolve([]);
    return Promise.resolve({ items: [], total: 0 });
  });
  post.mockReset();
  patch.mockReset();
});
afterEach(() => vi.clearAllMocks());

const view = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <ConfirmProvider>
          <OrdersQueuePage />
        </ConfirmProvider>
      </ToastProvider>
    </LocaleProvider>,
  );

describe('queue opens the order named in the URL', () => {
  it('fetches and opens ?order=<id> even when that order is not in the queue', async () => {
    params.current = new URLSearchParams('order=o-far');
    view();
    expect(await screen.findByText(/HM-260816-777/)).toBeTruthy();
    expect(get.mock.calls.some(([p]) => String(p).includes('/orders/manage/o-far'))).toBe(true);
  });

  it('fetches nothing extra without the parameter', async () => {
    view();
    await screen.findByText('Antrean pesanan');
    expect(get.mock.calls.some(([p]) => String(p).includes('/orders/manage/o-far'))).toBe(false);
  });
});
