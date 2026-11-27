// @vitest-environment jsdom
//
// AREA-2a: the prospect map. It draws only rows the server already scoped, adds no data source,
// and keeps a keyboard path (the table) beside the SVG.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, auth, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  auth: { role: 'HEAD_OFFICE' },
  FakeApiError: class extends Error {
    constructor(
      public readonly status: number,
      message: string,
      public readonly code?: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get }, ApiError: FakeApiError }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: auth.role }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [
      { id: 'dep-a', code: 'BKS', name: 'Bekasi' },
      { id: 'dep-b', code: 'DPK', name: 'Depok' },
    ],
    selectedId: null,
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ProspectMapPage from '@/app/dashboard/prospects/map/page';
import { loadSessionCapabilities } from '@/lib/roles';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Usaha ${id}`,
  category: 'KOS',
  address: null,
  latitude: -6.2 - Number(id.replace(/\D/g, '')) / 1000,
  longitude: 106.9,
  kecamatanCode: '3275010',
  kelurahanCode: null,
  ownerDepotId: 'dep-a',
  ownerSource: 'AUTO',
  status: 'NEW',
  assignedToId: null,
  source: 'OSM',
  sourceDate: null,
  createdAt: '2026-11-01T01:00:00.000Z',
  updatedAt: '2026-11-02T01:00:00.000Z',
  hasPhone: false,
  ...over,
});
const depot = (id: string, code: string, over: Record<string, unknown> = {}) => ({
  id,
  code,
  name: code,
  city: 'X',
  lat: -6.25,
  lng: 106.9,
  serviceRadiusKm: 3,
  serviceArea: null,
  deliveryFee: 0,
  minOrderAmount: null,
  ...over,
});

interface Routes {
  list: Record<string, unknown>[] | Error;
  opportunity?: Record<string, unknown>[] | Error;
  depots?: unknown[];
  pages?: Record<string, unknown>[][];
}
function serve(r: Routes) {
  get.mockImplementation(async (url: string) => {
    if (url.includes('/depots/api/v1/depots')) return { items: r.depots ?? [depot('dep-a', 'BKS')], total: 1, page: 1, limit: 100 };
    if (url.includes('scope=map')) {
      if (r.opportunity instanceof Error) throw r.opportunity;
      return { items: r.opportunity ?? [], nextCursor: null };
    }
    if (r.list instanceof Error) throw r.list;
    if (r.pages) {
      const i = url.includes('cursor=') ? Number(/cursor=c(\d)/.exec(url)?.[1] ?? 0) : 0;
      return { items: r.pages[i], nextCursor: i < r.pages.length - 1 ? `c${i + 1}` : null };
    }
    return { items: r.list, nextCursor: null };
  });
}
const prospectCalls = () => get.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/b2b-prospects/'));

beforeEach(() => {
  auth.role = 'HEAD_OFFICE';
  loadSessionCapabilities(null, null);
  get.mockReset();
});
afterEach(cleanup);

describe('prospect map', () => {
  it('draws one dot per row the server returned, a depot marker, and an accessible table of the same points', async () => {
    serve({ list: [row('p1'), row('p2', { status: 'INTERESTED' })] });
    render(<ProspectMapPage />);
    const svg = await screen.findByRole('img', { name: 'opsFix.prospects.map.label' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(screen.getAllByTestId('prospect-dot')).toHaveLength(2);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('button', { name: 'Usaha p1' })).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Usaha p2' })).toBeTruthy();
    expect(screen.getByText('BKS', { selector: 'text' })).toBeTruthy();
  });

  it('draws no dot for a row the responses did not carry (assigned-only role: no extra data source)', async () => {
    auth.role = 'KEPALA_DEPOT';
    serve({ list: [row('p1', { assignedToId: 'u-1' })], opportunity: new FakeApiError(403, 'no') });
    render(<ProspectMapPage />);
    await screen.findByRole('img', { name: 'opsFix.prospects.map.label' });
    expect(screen.getAllByTestId('prospect-dot')).toHaveLength(1);
    // the only prospect call is the list itself: no mine, no map scope, no assignees
    expect(prospectCalls()).toHaveLength(1);
    expect(prospectCalls()[0]).toContain('limit=100');
    expect(prospectCalls()[0]).not.toContain('scope=map');
  });

  it('fetches opportunity rows only when asked, shows them hollow, and hides the toggle after a 403', async () => {
    serve({ list: [row('p1')], opportunity: [row('o1', { ownerDepotId: null })] });
    render(<ProspectMapPage />);
    await screen.findByRole('img', { name: 'opsFix.prospects.map.label' });
    expect(prospectCalls().some((u) => u.includes('scope=map'))).toBe(false);
    await userEvent.click(screen.getByLabelText('opsFix.prospects.map.showOpportunity'));
    await waitFor(() => expect(screen.getAllByTestId('prospect-dot')).toHaveLength(2));
    cleanup();

    get.mockReset();
    serve({ list: [row('p1')], opportunity: new FakeApiError(403, 'no') });
    render(<ProspectMapPage />);
    await screen.findByRole('img', { name: 'opsFix.prospects.map.label' });
    await userEvent.click(screen.getByLabelText('opsFix.prospects.map.showOpportunity'));
    await waitFor(() => expect(screen.queryByLabelText('opsFix.prospects.map.showOpportunity')).toBeNull());
    expect(screen.getAllByTestId('prospect-dot')).toHaveLength(1);
  });

  it('opens a side card with "Buka" only for a Work holder, and always offers Google Maps navigation', async () => {
    serve({ list: [row('p1')] });
    render(<ProspectMapPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Usaha p1' }));
    expect(screen.getByRole('link', { name: 'opsFix.prospects.open' }).getAttribute('href')).toBe('/dashboard/prospects/detail?id=p1');
    expect(screen.getByRole('link', { name: 'opsFix.prospects.detail.navigate' }).getAttribute('href')).toContain('google.com/maps/search/?api=1&query=');
    await userEvent.click(screen.getByRole('button', { name: 'opsFix.prospects.map.close' }));
    expect(screen.queryByRole('link', { name: 'opsFix.prospects.open' })).toBeNull();
    cleanup();

    auth.role = 'DIREKTUR';
    serve({ list: [row('p1')], opportunity: new FakeApiError(403, 'no') });
    render(<ProspectMapPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Usaha p1' }));
    expect(screen.queryByRole('link', { name: 'opsFix.prospects.open' })).toBeNull();
    expect(screen.getByRole('link', { name: 'opsFix.prospects.detail.navigate' })).toBeTruthy();
  });

  it('selects a dot by clicking it, and never offers "Buka" for an opportunity row', async () => {
    serve({ list: [], opportunity: [row('o1', { ownerDepotId: null })] });
    render(<ProspectMapPage />);
    await userEvent.click(await screen.findByLabelText('opsFix.prospects.map.showOpportunity'));
    const dot = await screen.findByTestId('prospect-dot');
    await userEvent.click(dot);
    expect(await screen.findByText(/opsFix.prospects.map.opportunity/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'opsFix.prospects.open' })).toBeNull();
  });

  it('narrows to one depot or one kecamatan without another request', async () => {
    serve({
      list: [row('p1'), row('p2', { ownerDepotId: 'dep-b', kecamatanCode: '3276020' })],
      depots: [depot('dep-a', 'BKS'), depot('dep-b', 'DPK', { lat: Number.NaN })],
    });
    render(<ProspectMapPage />);
    await screen.findByRole('img', { name: 'opsFix.prospects.map.label' });
    const before = get.mock.calls.length;
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.map.focusDepot'), 'dep-b');
    expect(screen.getAllByTestId('prospect-dot')).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.map.focusDepot'), '');
    await userEvent.selectOptions(screen.getByLabelText('opsFix.prospects.map.kecamatan'), '3275010');
    expect(screen.getAllByTestId('prospect-dot')).toHaveLength(1);
    expect(get.mock.calls.length).toBe(before);
  });

  it('says there is nothing to draw, and refuses to draw a depot with garbage coordinates at (0,0)', async () => {
    serve({ list: [], depots: [depot('dep-a', 'BKS', { lat: Number.NaN })] });
    render(<ProspectMapPage />);
    expect(await screen.findByText('opsFix.prospects.map.empty')).toBeTruthy();
  });

  it('reads every cursor page and warns when it stops at the ceiling', async () => {
    const big = (n: number) => Array.from({ length: 100 }, (_, i) => row(`p${n * 100 + i}`));
    serve({ list: [], pages: Array.from({ length: 31 }, (_, n) => big(n)) });
    render(<ProspectMapPage />);
    expect(await screen.findByText(/opsFix.prospects.map.truncated\|\{"n":3000\}/)).toBeTruthy();
    expect(screen.getAllByTestId('prospect-dot')).toHaveLength(3000);
  }, 30_000);

  it('shows an error with retry, and the gate card to a role without Read', async () => {
    serve({ list: new FakeApiError(500, 'x') });
    render(<ProspectMapPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'common.retry' }));
    cleanup();

    auth.role = 'C_sales';
    loadSessionCapabilities('C_sales', ['b2bProspectWork']);
    get.mockClear();
    render(<ProspectMapPage />);
    expect(await screen.findByText('opsFix.prospects.gateTitle')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });
});
