// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-4-43 and CA-4-51 — two manager screens that printed a number or a name that was not
 * the thing they were captioned as.
 *
 *  - The price-rule list named each rule by `rule.productId`, a raw UUID, so the switch the
 *    manager was about to flip said nothing about which product's price it moved.
 *  - The home tile said "Kurir aktif" and counted DELIVERIES, so one courier holding four
 *    orders read as four couriers — and it asked for the whole network while sitting under
 *    one depot's name.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(',')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { assignedDepotId: 'depot-1' } }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-1',
    ready: true,
    error: null,
    reload: vi.fn(),
    depots: [{ id: 'depot-1', name: 'Depot Utama' }],
    selected: { id: 'depot-1', name: 'Depot Utama' },
  }),
}));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm: async () => true }) }));

import ManagerPricingPage from '@/app/m/manager/pricing/page';
import ManagerHome from '@/app/m/manager/page';

const rule = (id: string, productId: string | null) => ({
  id,
  depotId: 'depot-1',
  productId,
  adjustType: 'PERCENT' as const,
  value: 10,
  daysOfWeek: [],
  startMinute: null,
  endMinute: null,
  validFrom: null,
  validUntil: null,
  priority: 1,
  active: true,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CA-4-43 manager price rules', () => {
  it('names each rule by its product, never by the product UUID', async () => {
    get.mockImplementation((url: string) => {
      if (url.includes('/pricing/')) return Promise.resolve([rule('r1', 'prod-uuid-1')]);
      if (url.includes('/products/batch'))
        return Promise.resolve([{ id: 'prod-uuid-1', name: 'Galon 19L' }]);
      return Promise.resolve([]);
    });
    render(<ManagerPricingPage />);
    await waitFor(() => expect(screen.getByText('Galon 19L')).toBeTruthy());
    expect(screen.queryByText('prod-uuid-1')).toBeNull();
    // The accessible name of the switch is what a screen reader announces before it is
    // flipped, and it carried the UUID too.
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-label') ?? '').toContain('Galon 19L');
  });

  it('says the product is no longer active rather than falling back to the UUID', async () => {
    // `products/batch` answers with ACTIVE products only, so a rule pointing at a retired
    // product resolves to nothing — the one case that used to leak the id back onto screen.
    get.mockImplementation((url: string) => {
      if (url.includes('/pricing/')) return Promise.resolve([rule('r1', 'prod-uuid-9')]);
      return Promise.resolve([]);
    });
    render(<ManagerPricingPage />);
    await waitFor(() =>
      expect(screen.getByText('hrFix.managerPricing.inactiveProduct')).toBeTruthy(),
    );
    expect(screen.queryByText('prod-uuid-9')).toBeNull();
  });
});

describe('CA-4-51 manager home "Kurir aktif" tile', () => {
  it('counts couriers, not deliveries, and asks only for this depot', async () => {
    const delivery = (id: string, driverId: string) => ({
      id,
      driverId,
      depotId: 'depot-1',
      status: 'ON_DELIVERY',
      orderNumber: `ORD-${id}`,
    });
    get.mockImplementation((url: string) => {
      if (url.includes('/deliveries/api/v1/deliveries'))
        return Promise.resolve({
          // Three deliveries, TWO couriers: one of them is carrying two orders.
          items: [delivery('d1', 'cour-1'), delivery('d2', 'cour-1'), delivery('d3', 'cour-2')],
          total: 3,
        });
      if (url.includes('/inventory')) return Promise.resolve([]);
      if (url.includes('/approvals')) return Promise.resolve({ total: 0 });
      return Promise.resolve({ sales: { buckets: [] } });
    });
    render(<ManagerHome />);
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
    expect(screen.queryByText('3')).toBeNull();

    const url = get.mock.calls.map(([u]) => String(u)).find((u) => u.includes('/deliveries/api/v1/deliveries'));
    expect(url).toContain('depotId=depot-1');
  });
});
