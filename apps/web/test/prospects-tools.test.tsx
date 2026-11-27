// @vitest-environment jsdom
//
// AREA-2b: the list page's HQ tools (import link, Excel export, recompute owner depots) and the export flow's
// failure states. The audit rule lives on the server; the screen must not make a file when it says no.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, auth, qs, served, ask, download, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  download: vi.fn(),
  ask: { ok: true },
  served: { import: true },
  auth: { role: 'HEAD_OFFICE', depot: null as string | null },
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

vi.mock('@/lib/api', () => ({ api: { get, getCached: get, post }, ApiError: FakeApiError }));
vi.mock('@/lib/csv', async (orig) => ({ ...(await orig<typeof import('@/lib/csv')>()), downloadBlob: download }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    // Sheet tab names must stay distinct and under Excel's 31 characters.
    t: (k: string, vars?: Record<string, unknown>) =>
      k.includes('.sheets.') ? k.split('.').pop()! : vars ? `${k}|${JSON.stringify(vars)}` : k,
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: auth.role, assignedDepotId: auth.depot }, ready: true }),
}));
vi.mock('@/lib/deep-link', () => ({ isServedHere: (p: string) => (p.endsWith('/import') ? served.import : true) }));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => ask.ok), askReason: vi.fn() }),
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
vi.mock('@/lib/use-query-param', async () => {
  const React = await import('react');
  return {
    useQueryState: (name: string) => React.useState(qs[name] ?? ''),
    useQueryParam: (name: string) => qs[name] ?? '',
  };
});

import ProspectsPage from '@/app/dashboard/prospects/page';
import { loadSessionCapabilities } from '@/lib/roles';

const row = {
  id: 'p-1',
  name: 'Kos Mawar',
  category: 'KOS',
  phone: '+6281200000001',
  address: 'Jl. Mawar',
  latitude: -6.2,
  longitude: 106.9,
  kecamatanCode: '3275010',
  kecamatan: 'Bekasi Barat',
  kelurahanCode: null,
  kelurahan: null,
  status: 'NEW',
  ownerDepotId: 'dep-a',
  assignedToId: 'staff-1',
  source: 'OSM',
  licence: 'ODbL-1.0',
  sourceId: null,
  sourceDate: null,
};
const exported = (over: Record<string, unknown> = {}) => ({ rows: [row], truncated: false, rowCount: 1, visits: [], ...over });

function serve(exportResult: unknown = exported()) {
  get.mockImplementation(async (url: string) => {
    if (url.includes('/coverage')) {
      return { total: 1, onMap: 0, byCategory: [], byStatus: [{ status: 'DO_NOT_CONTACT', total: 2 }], bySource: [], dataAge: null, thirdPartyCostIdr: 0 };
    }
    if (url.includes('/assignees')) return [{ id: 'staff-1', name: 'Sari' }];
    if (url.includes('/depots/api/v1/depots')) return { items: [{ id: 'dep-a', code: 'BKS', name: 'Bekasi', serviceRadiusKm: 3 }] };
    return { items: [], nextCursor: null, truncated: false };
  });
  post.mockImplementation(async (url: string) => {
    if (exportResult instanceof Error) throw exportResult;
    if (url.endsWith('/export')) return exportResult;
    return { checked: 40, changed: 3, nowOnMap: 1 };
  });
}

const exportBtn = () => screen.queryByRole('button', { name: /prospectsIo\.tools\.export/ });
const recomputeBtn = () => screen.queryByRole('button', { name: /prospectsIo\.tools\.recompute$/ });

// exceljs is a big lazy chunk: warm it once so no test absorbs the load.
beforeAll(async () => {
  await import('exceljs');
}, 30_000);

beforeEach(() => {
  auth.role = 'HEAD_OFFICE';
  auth.depot = null;
  served.import = true;
  ask.ok = true;
  loadSessionCapabilities(null, null);
  for (const k of Object.keys(qs)) delete qs[k];
  get.mockReset();
  post.mockReset();
  download.mockReset();
  serve();
});
afterEach(cleanup);

describe('prospect list tools: who sees what', () => {
  it('head office sees the import link, the export and the recompute', async () => {
    render(<ProspectsPage />);
    expect(await screen.findByRole('link', { name: 'opsFix.prospectsIo.tools.import' })).toBeTruthy();
    expect(exportBtn()).toBeTruthy();
    expect(recomputeBtn()).toBeTruthy();
  });

  it('marketing may import and export but not recompute (reassign is head office only)', async () => {
    auth.role = 'MARKETING';
    render(<ProspectsPage />);
    await screen.findByRole('link', { name: 'opsFix.prospectsIo.tools.import' });
    expect(exportBtn()).toBeTruthy();
    expect(recomputeBtn()).toBeNull();
  });

  it('a Kepala exports its own depot but has no import link or recompute; a director only exports', async () => {
    auth.role = 'KEPALA_DEPOT';
    auth.depot = 'dep-a';
    const { unmount } = render(<ProspectsPage />);
    await waitFor(() => expect(exportBtn()).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'opsFix.prospectsIo.tools.import' })).toBeNull();
    expect(recomputeBtn()).toBeNull();
    unmount();
    auth.role = 'DIREKTUR';
    auth.depot = null;
    render(<ProspectsPage />);
    await waitFor(() => expect(exportBtn()).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'opsFix.prospectsIo.tools.import' })).toBeNull();
    expect(recomputeBtn()).toBeNull();
  });

  it('shows none of them in the Ops app, where the import page is pruned', async () => {
    served.import = false;
    render(<ProspectsPage />);
    await screen.findByText('opsFix.prospects.title');
    expect(screen.queryByRole('link', { name: 'opsFix.prospectsIo.tools.import' })).toBeNull();
    expect(exportBtn()).toBeNull();
    expect(recomputeBtn()).toBeNull();
  });

  it('offers the export on the list tab only, not on coverage', async () => {
    qs.tab = 'coverage';
    render(<ProspectsPage />);
    await screen.findByText('opsFix.prospects.title');
    expect(exportBtn()).toBeNull();
  });
});

describe('recompute owner depots', () => {
  it('asks first; a refusal calls nothing', async () => {
    ask.ok = false;
    render(<ProspectsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /tools\.recompute$/ }));
    expect(post).not.toHaveBeenCalled();
  });

  it('after the confirm it calls the route and shows what the server counted', async () => {
    render(<ProspectsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /tools\.recompute$/ }));
    expect(await screen.findByText('opsFix.prospectsIo.tools.recomputeDone|{"checked":40,"changed":3,"nowOnMap":1}')).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/b2b-prospects/api/v1/b2b-prospects/recompute-owners', {}, true);
  });

  it('says so on a 403 and on a 503, and plainly on anything else', async () => {
    for (const [status, key] of [
      [403, 'recomputeForbidden'],
      [503, 'recomputeUnavailable'],
      [500, 'recomputeFailed'],
    ] as const) {
      cleanup();
      serve(new FakeApiError(status, 'x'));
      render(<ProspectsPage />);
      await userEvent.click(await screen.findByRole('button', { name: /tools\.recompute$/ }));
      expect((await screen.findByRole('alert')).textContent).toBe(`opsFix.prospectsIo.tools.${key}`);
    }
  });
});

describe('export', () => {
  const run = async () => userEvent.click(await screen.findByRole('button', { name: /tools\.export/ }));

  it('posts the list filters, builds the workbook and downloads one file named for the network', async () => {
    qs.status = 'NEW';
    qs.category = 'KOS';
    render(<ProspectsPage />);
    await run();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const exportCall = post.mock.calls.find(([u]) => String(u).endsWith('/export'))!;
    expect(exportCall[1]).toEqual({ status: 'NEW', category: 'KOS' });
    expect(download.mock.calls[0]![0]).toMatch(/^prospek-opsFix\.prospectsIo\.export\.fileNetwork-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(download.mock.calls[0]![1]).toBeInstanceOf(Blob);
    // One coverage read per depot in scope for the do-not-contact sheet, one assignees read per owner depot.
    expect(get.mock.calls.filter(([u]) => String(u).includes('/coverage?depotId=')).map(([u]) => String(u).split('=')[1])).toEqual(['dep-a', 'dep-b']);
    expect(get.mock.calls.filter(([u]) => String(u).includes('/assignees'))).toHaveLength(1);
  });

  it('an audit failure (503) shows the server text plus "no file" and downloads nothing', async () => {
    serve(new FakeApiError(503, 'Ekspor dibatalkan: catatan audit gagal'));
    render(<ProspectsPage />);
    await run();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Ekspor dibatalkan: catatan audit gagal. opsFix.prospectsIo.export.noFile');
    expect(download).not.toHaveBeenCalled();
  });

  it('a 403 hides the button; any other failure says so and makes no file', async () => {
    serve(new FakeApiError(403, 'Forbidden'));
    render(<ProspectsPage />);
    await run();
    await waitFor(() => expect(exportBtn()).toBeNull());
    cleanup();
    serve(new FakeApiError(500, 'boom'));
    render(<ProspectsPage />);
    await run();
    expect((await screen.findByRole('alert')).textContent).toBe('opsFix.prospectsIo.export.failed');
    expect(download).not.toHaveBeenCalled();
  });

  it('a cut result still downloads, marked partial, with the banner; no rows means no file', async () => {
    serve(exported({ truncated: true }));
    render(<ProspectsPage />);
    await run();
    expect(await screen.findByText('opsFix.prospectsIo.export.truncated|{"max":5000}')).toBeTruthy();
    expect(download.mock.calls[0]![0]).toContain('filePartial');
    cleanup();
    download.mockReset();
    serve(exported({ rows: [], rowCount: 0 }));
    render(<ProspectsPage />);
    await run();
    expect(await screen.findByText('opsFix.prospectsIo.export.empty')).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
  });

  it('names the staff it cannot read "Staf" and survives a refused assignees or coverage read', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.includes('/depots/api/v1/depots')) return { items: [{ id: 'dep-a', code: 'BKS', name: 'Bekasi' }] };
      if (url.includes('/coverage') || url.includes('/assignees')) throw new FakeApiError(403, 'no');
      return { items: [], nextCursor: null, truncated: false };
    });
    render(<ProspectsPage />);
    await run();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1), { timeout: 15_000 });
  });

  it('writes "unreadable" (never 0) for a depot whose coverage read failed', async () => {
    const base = get.getMockImplementation()!;
    get.mockImplementation(async (url: string) => {
      if (url.includes('/coverage?depotId=dep-a')) throw new FakeApiError(500, 'down');
      return base(url);
    });
    render(<ProspectsPage />);
    await run();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await new Promise<ArrayBuffer>((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result as ArrayBuffer);
      fr.readAsArrayBuffer(download.mock.calls[0]![1] as Blob);
    }));
    const dnc = wb.worksheets[4]!;
    expect(dnc.getCell(2, 3).value).toBe('opsFix.prospectsIo.export.unreadable');
    expect(dnc.getCell(3, 3).value).toBe(2);
  }, 30_000);

  it('a role that cannot manage skips the assignees read and still gets its file', async () => {
    auth.role = 'DIREKTUR';
    render(<ProspectsPage />);
    await run();
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    expect(get.mock.calls.filter(([u]) => String(u).includes('/assignees'))).toHaveLength(0);
  });
});
