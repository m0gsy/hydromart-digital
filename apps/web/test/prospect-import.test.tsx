// @vitest-environment jsdom
//
// AREA-2b: the HQ import screen. Pick, check (dry run), commit; a commit only for the file that was checked.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, auth, download, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  download: vi.fn(),
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

vi.mock('@/lib/api', () => ({ api: { get, post }, ApiError: FakeApiError }));
vi.mock('@/lib/csv', async (orig) => ({ ...(await orig<typeof import('@/lib/csv')>()), downloadBlob: download }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k}|${JSON.stringify(vars)}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { id: 'u-1', role: auth.role }, ready: true }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ProspectImportPage from '@/app/dashboard/prospects/import/page';
import { loadSessionCapabilities } from '@/lib/roles';

const HEADER = 'name,category,lat,lng,source,license';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');
// jsdom's File has no .text(): give it the one the picker's File has.
const file = (content: string, name = 'a.csv') =>
  Object.assign(new File([content], name, { type: 'text/csv' }), { text: async () => content });

const summary = (over: Record<string, unknown> = {}) => ({
  dryRun: true,
  created: 1,
  updated: 0,
  skipped: 2,
  failed: 1,
  reasons: { LICENCE: 1, DO_NOT_CONTACT: 0, ALREADY_CUSTOMER: 0, DUPLICATE: 1 },
  results: [
    { row: 1, status: 'created' },
    { row: 2, status: 'skipped', reason: 'LICENCE', message: 'Lisensi tidak ada di daftar' },
    { row: 3, status: 'skipped', reason: 'DUPLICATE', message: 'Sudah ada dalam radius 150 m' },
    { row: 4, status: 'failed', message: 'Titik peta tidak terbaca' },
  ],
  ...over,
});
const FOUR = csv('Kos A,kos,-6.2,106.8,osm,ODbL-1.0', 'Kos B,kos,-6.2,106.8,osm,x', 'Kos C,kos,-6.2,106.8,osm,ODbL-1.0', 'Kos D,kos,,,osm,ODbL-1.0');

let onMap = 5;
function serve(opts: { dry?: unknown; commit?: unknown } = {}) {
  get.mockImplementation(async () => ({ total: 9, onMap, thirdPartyCostIdr: 0, byCategory: [], byStatus: [], bySource: [], dataAge: null }));
  post.mockImplementation(async (_url: string, body: { dryRun: boolean }) => {
    const pick = body.dryRun ? (opts.dry ?? summary()) : (opts.commit ?? summary({ dryRun: false }));
    if (pick instanceof Error) throw pick;
    if (!body.dryRun) onMap = 8; // the file put three rows on the map
    return pick;
  });
}

const input = () => document.querySelector('input[type=file]') as HTMLInputElement;
async function pick(content: string, name?: string) {
  await userEvent.upload(input(), file(content, name));
}
const button = (key: string) => screen.getByRole('button', { name: new RegExp(key.replace(/\./g, '\\.')) });

beforeEach(() => {
  auth.role = 'HEAD_OFFICE';
  onMap = 5;
  loadSessionCapabilities(null, null);
  get.mockReset();
  post.mockReset();
  download.mockReset();
  serve();
});
afterEach(cleanup);

describe('prospect import page', () => {
  it('shows the gate to a role without the import capability and offers no file input', () => {
    auth.role = 'KEPALA_DEPOT';
    render(<ProspectImportPage />);
    expect(screen.getByText('opsFix.prospectsIo.import.gateTitle')).toBeTruthy();
    expect(input()).toBeNull();
  });

  it('keeps the file input out of display:none (sr-only) so the keyboard can reach it', () => {
    render(<ProspectImportPage />);
    expect(input().className).toContain('sr-only');
    expect(input().className).not.toMatch(/\bhidden\b/);
  });

  it('refuses a file with a missing required column, too many rows, a legacy file and a wrong type', async () => {
    render(<ProspectImportPage />);
    await pick('name,lat\nKos,1');
    expect(await screen.findByText(/opsFix\.import\.missingColumns\|.*category, lng, source, license/)).toBeTruthy();
    const many = csv(...Array.from({ length: 501 }, (_, i) => `K${i},kos,-6,106,osm,ODbL-1.0`));
    await pick(many);
    expect(await screen.findByText(/opsFix\.import\.tooManyRows\|.*501/)).toBeTruthy();
    await pick('x', 'a.xls');
    expect(await screen.findByText('opsFix.import.legacyFormat')).toBeTruthy();
    await pick('x', 'a.pdf');
    expect(await screen.findByText(/opsFix\.import\.wrongFileType/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('a commit needs a check of the same file: dry run first, the counts, the four reasons, and each row verdict', async () => {
    render(<ProspectImportPage />);
    await pick(FOUR);
    expect((button('opsFix.prospectsIo.import.commit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('opsFix.prospectsIo.import.commitNeedsCheck')).toBeTruthy();

    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    await screen.findByText('opsFix.prospectsIo.import.checkTitle');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![1]).toMatchObject({ dryRun: true });
    expect(post.mock.calls[0]![1].rows).toHaveLength(4);
    expect(Object.keys(post.mock.calls[0]![1].rows[0])).toHaveLength(19);

    expect(screen.getByText('opsFix.prospectsIo.import.willCreate: 1')).toBeTruthy();
    expect(screen.getByText('opsFix.prospectsIo.import.refused: 2')).toBeTruthy();
    expect(screen.getByText('opsFix.prospectsIo.import.unreadable: 1')).toBeTruthy();
    for (const [r, n] of [['LICENCE', 1], ['DO_NOT_CONTACT', 0], ['ALREADY_CUSTOMER', 0], ['DUPLICATE', 1]] as const) {
      expect(screen.getByText(`opsFix.prospectsIo.import.reasons.${r}: ${n}`)).toBeTruthy();
    }
    // The server's messages are shown verbatim, beside the name from the file.
    const lic = screen.getByText('Lisensi tidak ada di daftar').closest('tr')!;
    expect(within(lic).getByText('Kos B')).toBeTruthy();
    expect(screen.getByText('Titik peta tidak terbaca').closest('tr')!.textContent).toContain('opsFix.prospectsIo.import.unreadable');
    expect((button('opsFix.prospectsIo.import.commit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a new pick forgets the check: the commit is off again and the old verdicts are gone', async () => {
    render(<ProspectImportPage />);
    await pick(FOUR);
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    await screen.findByText('opsFix.prospectsIo.import.checkTitle');
    await pick(csv('Kos Z,kos,-6.2,106.8,osm,ODbL-1.0'));
    await screen.findByText(/opsFix\.prospectsIo\.import\.fileName/);
    expect(screen.queryByText('opsFix.prospectsIo.import.checkTitle')).toBeNull();
    expect((button('opsFix.prospectsIo.import.commit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('commits the same rows, then shows the result, the map delta from two coverage reads, and the third-party cost', async () => {
    render(<ProspectImportPage />);
    await pick(FOUR);
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    await screen.findByText('opsFix.prospectsIo.import.checkTitle');
    await userEvent.click(button('opsFix.prospectsIo.import.commit'));
    await screen.findByText('opsFix.prospectsIo.import.resultTitle');

    expect(post.mock.calls[1]![1]).toMatchObject({ dryRun: false });
    expect(post.mock.calls[1]![1].rows).toEqual(post.mock.calls[0]![1].rows);
    expect(post.mock.calls[1]![1]).not.toHaveProperty('costIdr');
    expect(screen.getByText('opsFix.prospectsIo.import.created: 1')).toBeTruthy();
    expect(screen.getByText('opsFix.prospectsIo.import.onMap|{"count":3}')).toBeTruthy(); // 8 after minus 5 before
    expect(screen.getByText('opsFix.prospectsIo.import.cost|{"amount":"0"}')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /import\.commit/ })).toBeNull();
  });

  it('filters the verdict table by outcome and pages it 50 rows at a time', async () => {
    const results = Array.from({ length: 120 }, (_, i) => ({ row: i + 1, status: 'created' }));
    serve({ dry: summary({ created: 120, skipped: 0, failed: 0, results }) });
    render(<ProspectImportPage />);
    await pick(csv(...Array.from({ length: 120 }, (_, i) => `K${i},kos,-6,106,osm,ODbL-1.0`)));
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    await screen.findByText('opsFix.prospectsIo.import.checkTitle');
    expect(screen.getByText('opsFix.prospectsIo.import.rowsOf|{"shown":50,"total":120}')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'common.loadMore' }));
    expect(screen.getByText('opsFix.prospectsIo.import.rowsOf|{"shown":100,"total":120}')).toBeTruthy();
    await userEvent.click(button('opsFix.prospectsIo.import.filter.failed'));
    expect(screen.getByText('opsFix.prospectsIo.import.rowsOf|{"shown":0,"total":0}')).toBeTruthy();
  });

  it('downloads the refused and failed rows with the verdict and message', async () => {
    render(<ProspectImportPage />);
    await pick(FOUR);
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    await screen.findByText('opsFix.prospectsIo.import.checkTitle');
    await userEvent.click(button('opsFix.prospectsIo.import.downloadRefused'));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]![0]).toBe('opsFix.prospectsIo.import.refusedFile.xlsx');
  });

  it('a 403 swaps the screen for the gate', async () => {
    serve({ dry: new FakeApiError(403, 'Forbidden') });
    render(<ProspectImportPage />);
    await pick(FOUR);
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    expect(await screen.findByText('opsFix.prospectsIo.import.gateTitle')).toBeTruthy();
  });

  it('a 400 shows the server text; a 503 says try again and leaves the commit on for a safe retry', async () => {
    serve({ dry: new FakeApiError(400, 'rows must contain no more than 500 elements') });
    render(<ProspectImportPage />);
    await pick(FOUR);
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    expect((await screen.findByRole('alert')).textContent).toBe('rows must contain no more than 500 elements');

    serve({ commit: new FakeApiError(503, 'depot-service down') });
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    await screen.findByText('opsFix.prospectsIo.import.checkTitle');
    await userEvent.click(button('opsFix.prospectsIo.import.commit'));
    expect((await screen.findByRole('alert')).textContent).toBe('opsFix.prospectsIo.import.unavailable');
    expect((button('opsFix.prospectsIo.import.commit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says the map count is unknown when coverage cannot be read, and shows a plain failure for an unknown error', async () => {
    get.mockRejectedValue(new Error('down'));
    render(<ProspectImportPage />);
    await pick(FOUR);
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    await screen.findByText('opsFix.prospectsIo.import.checkTitle');
    await userEvent.click(button('opsFix.prospectsIo.import.commit'));
    expect(await screen.findByText('opsFix.prospectsIo.import.onMapUnknown')).toBeTruthy();

    cleanup();
    serve({ dry: new Error('boom') });
    render(<ProspectImportPage />);
    await pick(FOUR);
    await userEvent.click(button('opsFix.prospectsIo.import.check'));
    expect((await screen.findByRole('alert')).textContent).toBe('opsFix.prospectsIo.import.failed');
  });
});
