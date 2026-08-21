// @vitest-environment jsdom
/**
 * D7 · the saving quoted was never the saving charged.
 *
 * The screen asked for the discount rate of the depot behind the shopper's BROWSING
 * location — wherever they happen to be standing. The sweep charges the rate of the depot
 * that routes from the SAVED ADDRESS the subscription is delivered to. Two depots, two
 * rates, and nothing anywhere reconciled them: a customer browsing near a depot that gives
 * 10% is quoted 10% and billed the 5% their home depot gives, every delivery, forever.
 */
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/subscriptions',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1', role: 'CUSTOMER' }, ready: true, signOut: vi.fn() }),
}));
// The shopper is standing next to depot-browsing. Their saved address belongs to depot-home.
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: { depotId: 'depot-browsing', label: 'Dekat sini' } }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post } };
});

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import SubscriptionsPage from '@/app/subscriptions/page';

/** The screen toasts on every refusal, so both providers have to be real. */
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

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  get.mockReset().mockImplementation(async (path: string) => {
    if (path.includes('/addresses')) return [ADDRESS];
    if (path.includes('/depots/nearby')) return [{ id: 'depot-home', name: 'Depot Rumah' }];
    if (path.includes('/subscriptions/discount')) return { rate: 0.05 };
    if (path.includes('/subscriptions')) return [];
    if (path.includes('/products')) return { items: [], total: 0, page: 1, limit: 50 };
    return [];
  });
});
afterEach(() => vi.clearAllMocks());

describe('D7 · the saving quoted is the saving charged', () => {
  it('quotes the discount against the depot that serves the saved address', async () => {
    render(<SubscriptionsPage />, { wrapper });

    await waitFor(() => {
      const asked = get.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => p.includes('/subscriptions/discount'));
      expect(asked.length).toBeGreaterThan(0);
      // The depot the sweep will actually price against — not the one behind wherever the
      // shopper happens to be browsing.
      expect(asked.some((p) => p.includes('depot-home'))).toBe(true);
      expect(asked.some((p) => p.includes('depot-browsing'))).toBe(false);
    });
  });

  // An address with no map pin cannot be routed by anybody — not by the client, not by the
  // sweep. Quoting the browsing depot's rate there would be the same bug wearing a
  // different hat, so the quote falls back to the global default instead.
  it('falls back to the global rate when the address has no map pin', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('/addresses')) return [{ ...ADDRESS, latitude: null, longitude: null }];
      if (path.includes('/depots/nearby')) return [{ id: 'depot-home', name: 'Depot Rumah' }];
      if (path.includes('/subscriptions/discount')) return { rate: 0.05 };
      if (path.includes('/subscriptions')) return [];
      if (path.includes('/products')) return { items: [], total: 0, page: 1, limit: 50 };
      return [];
    });

    render(<SubscriptionsPage />, { wrapper });

    await waitFor(() => {
      const asked = get.mock.calls
        .map((c) => String(c[0]))
        .filter((p) => p.includes('/subscriptions/discount'));
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((p) => !p.includes('depot-'))).toBe(true);
    });
    // And it never asked the nearby lookup a question it has no coordinates for.
    expect(get.mock.calls.map((c) => String(c[0])).some((p) => p.includes('/depots/nearby'))).toBe(
      false,
    );
  });
});
