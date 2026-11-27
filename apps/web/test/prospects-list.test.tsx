// @vitest-environment jsdom
//
// AREA-2a: the prospect list. Tab set per role, what each role may open, and the failure states.
// The server owns the reach rule; these tests hold the screen to calling only what a role may call.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, auth, qs, served, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  served: { map: true },
  auth: { role: 'KEPALA_DEPOT', depot: null as string | null },
  qs: {} as Record<string, string>,
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
  useAuth: () => ({ customer: { id: 'u-1', role: auth.role, assignedDepotId: auth.depot }, ready: true }),
}));
vi.mock('@/lib/deep-link', () => ({ isServedHere: () => served.map }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [{ id: 'dep-a', code: 'BKS', name: 'Bekasi' }], selectedId: null }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-query-param', async () => {
  const React = await import('react');
  return {
    useQueryState: (name: string) => React.useState(qs[name] ?? ''),
    useQueryParam: (name: string) => qs[name] ?? '',
  };
});

import ProspectsPage from '@/app/dashboard/prospects/page';
import { loadSessionCapabilities } from '@/lib/roles';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p-1',
  name: 'Kos Mawar',
  category: 'KOS',
  address: 'Jl. Mawar',
  latitude: -6.2,
  longitude: 106.9,
  kecamatanCode: '3275010',
  kelurahanCode: null,
  ownerDepotId: 'dep-a',
  ownerSource: 'AUTO',
  status: 'NEW',
  assignedToId: 'staff-9',
  source: 'OSM',
  sourceDate: '2026-10-01',
  createdAt: '2026-11-01T01:00:00.000Z',
  updatedAt: '2026-11-02T01:00:00.000Z',
  hasPhone: true,
  ...over,
});

interface Routes {
  list?: unknown;
  mine?: unknown;
  assignees?: unknown;
  coverage?: unknown;
  opportunity?: unknown;
}
function serve(r: Routes) {
  get.mockImplementation(async (url: string) => {
    const pick = url.includes('/assignees')
      ? r.assignees
      : url.includes('/mine')
        ? r.mine
        : url.includes('/coverage')
          ? r.coverage
          : url.includes('scope=map')
            ? r.opportunity
            : r.list;
    if (pick instanceof Error) throw pick;
    if (pick === undefined) throw new FakeApiError(404, 'no route in this test');
    return pick;
  });
}
const calls = (part: string) => get.mock.calls.filter(([u]) => String(u).includes(part));
const page = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor });

beforeEach(() => {
  auth.role = 'KEPALA_DEPOT';
  auth.depot = null;
  served.map = true;
  loadSessionCapabilities(null, null);
  for (const k of Object.keys(qs)) delete qs[k];
  get.mockReset();
});
afterEach(cleanup);

describe('prospect list', () => {
  it('shows a Kepala the all / mine / coverage tabs, opens rows, and names the assignee from the roster call', async () => {
    serve({
      list: page([row(), row({ id: 'p-2', name: 'Klinik Sehat', assignedToId: 'u-1', ownerDepotId: 'dep-a' })]),
      assignees: [{ id: 'staff-9', name: 'Sari' }],
      opportunity: new FakeApiError(403, 'forbidden'),
    });
    render(<ProspectsPage />);
    const link = await screen.findByRole('link', { name: 'Kos Mawar' });
    expect(link.getAttribute('href')).toBe('/dashboard/prospects/detail?id=p-1');
    expect(await screen.findByText('Sari')).toBeTruthy();
    expect(screen.getByText('opsFix.prospects.me')).toBeTruthy();
    expect(screen.getAllByText('BKS', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('opsFix.prospects.tabs.all')).toBeTruthy();
    expect(screen.getByText('opsFix.prospects.tabs.mine')).toBeTruthy();
    expect(screen.getByText('opsFix.prospects.tabs.coverage')).toBeTruthy();
    // a depot role is refused the opportunity map, so the tab never appears
    expect(screen.queryByText('opsFix.prospects.tabs.opportunity')).toBeNull();
    // one assignees call per distinct owner depot
    expect(calls('/assignees')).toHaveLength(1);
    // never a phone or contact on the list
    expect(document.body.textContent).not.toMatch(/\+62|Bu Sari/);
  });

  it('shows Direksi the list and coverage, rows not openable, and calls neither mine nor assignees', async () => {
    auth.role = 'DIREKTUR';
    serve({ list: page([row()]), opportunity: page([]) });
    render(<ProspectsPage />);
    expect(await screen.findByText('Kos Mawar')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Kos Mawar' })).toBeNull();
    expect(screen.queryByText('opsFix.prospects.tabs.mine')).toBeNull();
    expect(screen.getByText('opsFix.prospects.tabs.coverage')).toBeTruthy();
    expect(screen.getAllByText('opsFix.prospects.otherStaff').length).toBeGreaterThan(0);
    expect(calls('/mine')).toHaveLength(0);
    expect(calls('/assignees')).toHaveLength(0);
  });

  it('lands a Work-only role on Milik saya and never calls the list, coverage or opportunity routes', async () => {
    auth.role = 'C_sales';
    loadSessionCapabilities('C_sales', ['b2bProspectWork']);
    serve({ mine: page([row({ phoneE164: '+628123', assignedToId: 'u-1' })]) });
    render(<ProspectsPage />);
    expect(await screen.findByRole('link', { name: 'Kos Mawar' })).toBeTruthy();
    expect(screen.getAllByText('opsFix.prospects.me').length).toBeGreaterThan(0);
    expect(screen.queryByText('opsFix.prospects.tabs.all')).toBeNull();
    expect(screen.queryByText('opsFix.prospects.tabs.coverage')).toBeNull();
    expect(calls('/mine')).toHaveLength(1);
    expect(get.mock.calls.filter(([u]) => !String(u).includes('/mine'))).toHaveLength(0);
  });

  it('shows head office the opportunity tab and opens an opportunity row only for reassign', async () => {
    auth.role = 'HEAD_OFFICE';
    qs.tab = 'opportunity';
    serve({ list: page([]), opportunity: page([row({ ownerDepotId: null, assignedToId: null })]) });
    render(<ProspectsPage />);
    expect(await screen.findByRole('link', { name: 'Kos Mawar' })).toBeTruthy();
    expect(screen.getByText('opsFix.prospects.tabs.opportunity')).toBeTruthy();
    expect(screen.getByText('opsFix.prospects.noDepot', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('opsFix.prospects.opportunityNote')).toBeTruthy();
  });

  it('hides the map link where the route is pruned (Ops binary)', async () => {
    served.map = false;
    serve({ list: page([row()]), assignees: [], opportunity: new FakeApiError(403, 'no') });
    render(<ProspectsPage />);
    await screen.findByText('Kos Mawar');
    expect(screen.queryByText('opsFix.prospects.mapOpen')).toBeNull();
    cleanup();
    served.map = true;
    serve({ list: page([row()]), assignees: [], opportunity: new FakeApiError(403, 'no') });
    render(<ProspectsPage />);
    expect(await screen.findByText('opsFix.prospects.mapOpen')).toBeTruthy();
  });

  it('never probes the opportunity map for a depot-bound account', async () => {
    auth.depot = 'dep-a';
    serve({ list: page([row()]), assignees: [] });
    render(<ProspectsPage />);
    await screen.findByText('Kos Mawar');
    expect(calls('scope=map')).toHaveLength(0);
  });

  it('ignores a hand-typed tab the role lacks and makes no call the role would be refused', async () => {
    auth.role = 'DIREKTUR';
    qs.tab = 'mine';
    serve({ list: page([row()]), opportunity: page([]) });
    render(<ProspectsPage />);
    await screen.findByText('Kos Mawar');
    expect(calls('/mine')).toHaveLength(0);
    cleanup();
    auth.role = 'C_sales';
    loadSessionCapabilities('C_sales', ['b2bProspectWork']);
    qs.tab = 'coverage';
    get.mockClear();
    serve({ mine: page([row()]) });
    render(<ProspectsPage />);
    await screen.findByText('Kos Mawar');
    expect(calls('/coverage')).toHaveLength(0);
  });

  it('shows the gate card when the capability disappears mid-session (403)', async () => {
    serve({ list: new FakeApiError(403, 'no'), opportunity: new FakeApiError(403, 'no') });
    render(<ProspectsPage />);
    expect(await screen.findByText('opsFix.prospects.gateTitle')).toBeTruthy();
  });

  it('refuses a role with neither Read nor Work without calling anything', async () => {
    auth.role = 'CUSTOMER';
    serve({});
    render(<ProspectsPage />);
    expect(await screen.findByText('opsFix.prospects.gateTitle')).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('retries after a network error, and says so when there is nothing to show', async () => {
    serve({ list: new FakeApiError(0, 'down'), opportunity: new FakeApiError(403, 'no') });
    render(<ProspectsPage />);
    const retry = await screen.findByRole('button', { name: 'common.retry' });
    serve({ list: page([]), opportunity: new FakeApiError(403, 'no') });
    await userEvent.click(retry);
    expect(await screen.findByText('opsFix.prospects.empty')).toBeTruthy();
  });

  it('says "none assigned to you" on an empty Milik saya', async () => {
    auth.role = 'C_sales';
    loadSessionCapabilities('C_sales', ['b2bProspectWork']);
    serve({ mine: page([]) });
    render(<ProspectsPage />);
    expect(await screen.findByText('opsFix.prospects.emptyMine')).toBeTruthy();
  });

  it('keeps the list when the assignee names fail (503) and falls back to "Staf lain"', async () => {
    serve({ list: page([row()]), assignees: new FakeApiError(503, 'down'), opportunity: new FakeApiError(403, 'no') });
    render(<ProspectsPage />);
    expect(await screen.findByText('Kos Mawar')).toBeTruthy();
    await waitFor(() => expect(calls('/assignees')).toHaveLength(1));
    expect(screen.getByText('opsFix.prospects.otherStaff')).toBeTruthy();
  });

  it('pages by cursor with "Muat lebih banyak" and reports a failed later page under the rows', async () => {
    const seen: string[] = [];
    get.mockImplementation(async (url: string) => {
      seen.push(url);
      if (url.includes('/assignees')) return [];
      if (url.includes('scope=map')) throw new FakeApiError(403, 'no');
      if (url.includes('cursor=c1')) return page([row({ id: 'p-2', name: 'Sekolah Dua' })]);
      return page([row()], 'c1');
    });
    render(<ProspectsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'common.loadMore' }));
    expect(await screen.findByText('Sekolah Dua')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common.loadMore' })).toBeNull();
    expect(seen.some((u) => u.includes('limit=50'))).toBe(true);
  });

  it('shows a failed later page without dropping the first', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.includes('/assignees')) return [];
      if (url.includes('scope=map')) throw new FakeApiError(403, 'no');
      if (url.includes('cursor=c1')) throw new FakeApiError(500, 'page two broke');
      return page([row()], 'c1');
    });
    render(<ProspectsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'common.loadMore' }));
    expect(await screen.findByText('page two broke')).toBeTruthy();
    expect(screen.getByText('Kos Mawar')).toBeTruthy();
  });

  it('sends the filters as query parameters, assigned only for a manager, and the name search on submit', async () => {
    qs.status = 'LOST';
    qs.category = 'KOS';
    qs.kecamatan = '3275010';
    qs.assigned = 'none';
    serve({ list: page([row()]), assignees: [], opportunity: new FakeApiError(403, 'no') });
    render(<ProspectsPage />);
    await screen.findByText('Kos Mawar');
    const url = String(calls('scope=work')[0]?.[0]);
    expect(url).toContain('status=LOST');
    expect(url).toContain('category=KOS');
    expect(url).toContain('kecamatanCode=3275010');
    expect(url).toContain('assigned=none');
    await userEvent.type(screen.getByLabelText('opsFix.prospects.filters.search'), 'Mawar{enter}');
    await waitFor(() => expect(get.mock.calls.some(([u]) => String(u).includes('q=Mawar'))).toBe(true));
  });

  it('renders the coverage tab: counts only, third-party cost hidden when null', async () => {
    qs.tab = 'coverage';
    serve({
      coverage: {
        total: 120,
        onMap: 12,
        byCategory: [{ category: 'KOS', total: 80, withPhone: 40, withPhonePct: 50 }],
        byStatus: [{ status: 'NEW', total: 100 }],
        bySource: [{ source: 'OSM', total: 120 }],
        dataAge: { newestDays: 3, medianDays: 30, oldestDays: 90 },
        thirdPartyCostIdr: null,
      },
      opportunity: new FakeApiError(403, 'no'),
    });
    render(<ProspectsPage />);
    expect((await screen.findAllByText('120')).length).toBeGreaterThan(0);
    expect(screen.getByText('50.0%', { exact: false })).toBeTruthy();
    expect(screen.queryByText('opsFix.prospects.coverage.cost')).toBeNull();
  });

  it('shows the third-party cost and "no data" age to a network role, and an error with retry', async () => {
    auth.role = 'HEAD_OFFICE';
    qs.tab = 'coverage';
    serve({
      coverage: {
        total: 1,
        onMap: 0,
        byCategory: [],
        byStatus: [],
        bySource: [],
        dataAge: null,
        thirdPartyCostIdr: 0,
      },
      opportunity: page([]),
    });
    const view = render(<ProspectsPage />);
    expect(await screen.findByText('opsFix.prospects.coverage.cost')).toBeTruthy();
    expect(screen.getByText('opsFix.prospects.coverage.noAge')).toBeTruthy();
    view.unmount();
    serve({ coverage: new FakeApiError(500, 'x'), opportunity: page([]) });
    render(<ProspectsPage />);
    expect(await screen.findByText('opsFix.prospects.coverage.loadFailed')).toBeTruthy();
  });
});
