// @vitest-environment jsdom
/**
 * The Franchise Owner may read the forecast but not the depot's stock. The forecast screen
 * also asked for the stock (to turn a forecast into "days to stockout"); that read answered
 * 403, and the screen painted its "could not load" banner on a page that was working. A
 * role without `inventoryRead` must not make the request at all.
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, role } = vi.hoisted(() => ({ get: vi.fn(), role: { current: 'FRANCHISE_OWNER' } }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/forecast',
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1', role: role.current }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd1', name: 'Depot Dago' }],
    selected: { id: 'd1', name: 'Depot Dago' },
    selectedId: 'd1',
    scopedId: 'd1',
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));

import ForecastPage from '@/app/dashboard/forecast/page';
import { endpoints } from '@/lib/endpoints';
import { LocaleProvider } from '@/lib/locale-context';

function show() {
  render(
    <LocaleProvider>
      <ForecastPage />
    </LocaleProvider>,
  );
}

const SALES = {
  depotId: 'd1',
  avgDaily: 0,
  trendSlope: 0,
  predictedDaily: [],
  predictedTotal: 0,
  history: [],
};

beforeEach(() => {
  get
    .mockReset()
    .mockImplementation(async (url: string) => (url.includes('/forecast/sales') ? SALES : []));
});

describe('forecast screen — the stock read follows the stock permission', () => {
  it('does not ask a Franchise Owner for the depot stock', async () => {
    role.current = 'FRANCHISE_OWNER';
    show();
    await waitFor(() => expect(get).toHaveBeenCalled());
    const asked = get.mock.calls.map((c) => c[0]);
    expect(asked).not.toContain(endpoints.inventory.lines('d1'));
  });

  it('still asks a role that may read stock', async () => {
    role.current = 'KEPALA_DEPOT';
    show();
    await waitFor(() => expect(get).toHaveBeenCalledWith(endpoints.inventory.lines('d1'), true));
  });
});
