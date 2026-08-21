// @vitest-environment jsdom
/**
 * D3 · a plan whose saved address has no map pin can never be routed to a depot.
 *
 * `placeScheduled` resolves a depot from the address snapshot and has nothing to fall back
 * on — no customer to ask, no depot picker, no session — so it throws, the sweep catches
 * and skips, and the schedule never advances. The plan sat on this screen reading "Aktif",
 * its next-delivery date frozen in the past, delivering nothing and explaining nothing.
 * The customer set it up and waited.
 *
 * New ones are refused at creation (order-service). The ones already sitting here say why.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/subscriptions',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1', role: 'CUSTOMER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: { depotId: 'depot-home', label: 'Rumah' } }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post } };
});

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import SubscriptionsPage from '@/app/subscriptions/page';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>{children}</ToastProvider>
  </LocaleProvider>
);

const ADDRESS = {
  id: 'a1',
  label: 'Rumah',
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
  postalCode: '40111',
  latitude: -6.9,
  longitude: 107.6,
  isPrimary: true,
};

const PLAN = {
  id: 's1',
  customerId: 'c1',
  productId: 'p1',
  productName: 'Galon 19L',
  unit: 'Galon',
  quantity: 2,
  frequency: 'WEEKLY',
  status: 'ACTIVE',
  nextDeliveryAt: '2026-07-01T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

const withPlan = (plan: Record<string, unknown>) => async (path: string) => {
  if (path.includes('/addresses')) return [ADDRESS];
  if (path.includes('/depots/nearby')) return [{ id: 'depot-home', name: 'Depot Rumah' }];
  if (path.includes('/subscriptions/discount')) return { rate: 0.05 };
  if (path.includes('/subscriptions')) return [plan];
  if (path.includes('/products')) return { items: [], total: 0, page: 1, limit: 50 };
  return [];
};

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  get.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('D3 · a dead subscription says why it is dead', () => {
  it('warns on a plan whose address has no map pin', async () => {
    get.mockImplementation(withPlan({ ...PLAN, latitude: null, longitude: null }));
    render(<SubscriptionsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText(/belum punya titik peta/i)).toBeTruthy());
  });

  // The other half, or the warning becomes wallpaper: a routable plan must not carry it.
  it('says nothing about a plan that can actually be delivered', async () => {
    get.mockImplementation(withPlan({ ...PLAN, latitude: -6.9, longitude: 107.6 }));
    render(<SubscriptionsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
    expect(screen.queryByText(/belum punya titik peta/i)).toBeNull();
  });
});
