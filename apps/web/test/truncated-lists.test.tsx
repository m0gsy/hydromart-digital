// @vitest-environment jsdom
/**
 * The "list silently stops at N" family — CA-1-16, CA-1-18, CA-1-19, CA-2-25, CA-2-26,
 * CA-2-27, CA-2-28, CA-2-40, CA-2-10.
 *
 * Every one of these bugs shipped past review, past a browser pass, and past a full test
 * suite, for the same reason: a truncated list is INDISTINGUISHABLE from a short one. There
 * is nothing to look at. So the assertions here are all of the same shape — build a server
 * that holds MORE rows than one page, then insist the screen either reaches them or says out
 * loud that it has not.
 *
 * The three harms get three different proofs, deliberately:
 *
 *  (a) a QUEUE that buries work → the row past the first page must be reachable;
 *  (b) a COUNT or an EXPORT built from a slice → the number must be right, or refused;
 *  (c) a display list that stops → it must state how much of the list it is showing.
 *
 * Revert any one fix and the matching test goes red. That is the whole point of the file.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, patch: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'SUPER_ADMIN' } }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-a',
    selectedId: null,
    selected: null,
    depots: [{ id: 'depot-a', name: 'Depot A', code: 'DPA' }],
    ready: true,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq',
  useSearchParams: () => new URLSearchParams(),
}));

const { downloadXlsx } = vi.hoisted(() => ({
  // Typed with its real signature so a test can read the BODY it was handed — which is the
  // whole assertion for the two export rows in this file.
  downloadXlsx: vi.fn(
    async (_name: string, _headers: string[], _body: unknown[][], _sheet?: string) => undefined,
  ),
}));
vi.mock('@/lib/xlsx', () => ({ downloadXlsx }));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import { fetchAllDepots } from '@/lib/all-depots';
import { usePagedList } from '@/lib/use-paged-list';
import HqApplicationsPage from '@/app/hq/applications/page';
import HqAuditPage from '@/app/hq/audit/page';
import HqReportsExportPage from '@/app/hq/reports/export/page';
import HqReconciliationPage from '@/app/hq/reconciliation/page';
import DashboardOrdersPage from '@/app/dashboard/orders/page';
import HrEmployeesPage from '@/app/hr/employees/page';
import MyAttendancePage from '@/app/hr/me/attendance/page';
import LeaveQueuePage from '@/app/hr/leave/page';

beforeEach(() => {
  get.mockReset();
  downloadXlsx.mockClear();
});
afterEach(() => vi.clearAllMocks());

const ui = (node: React.ReactNode) =>
  render(
    <LocaleProvider>
      <ToastProvider>{node}</ToastProvider>
    </LocaleProvider>,
  );

/** Read `page`/`limit` (or `pageSize`) off a URL the screen actually built. */
function paging(url: string): { page: number; limit: number } {
  const q = new URLSearchParams(url.split('?')[1] ?? '');
  return {
    page: Number(q.get('page') ?? 1),
    limit: Number(q.get('limit') ?? q.get('pageSize') ?? 0),
  };
}

/** A server holding `total` rows of `make(i)`, answering honest pages of whatever is asked. */
function pagedServer<T>(total: number, make: (i: number) => T, key: 'items' | 'rows' = 'items') {
  return (url: string) => {
    const { page, limit } = paging(url);
    const size = limit || 20;
    const start = (page - 1) * size;
    const rows = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) =>
      make(start + i),
    );
    return Promise.resolve({ [key]: rows, total, page, limit: size });
  };
}

describe('usePagedList — the shared hook the screens are built on', () => {
  function Harness({
    pages,
  }: {
    pages: (page: number) => Promise<{ items: string[]; total: number }>;
  }) {
    const [filter, setFilter] = useState('a');
    const list = usePagedList(pages, [filter]);
    return (
      <div>
        <span data-testid="rows">{list.rows.join(',')}</span>
        <span data-testid="meta">{`${list.rows.length}/${list.total}${list.hasMore ? '+' : ''}`}</span>
        <button onClick={list.loadMore}>more</button>
        <button onClick={() => setFilter('b')}>filter</button>
      </div>
    );
  }

  const server = (total: number, tag = 'x') =>
    vi.fn(async (page: number) => ({
      items: Array.from(
        { length: Math.min(3, Math.max(0, total - (page - 1) * 3)) },
        (_, i) => `${tag}${(page - 1) * 3 + i}`,
      ),
      total,
    }));

  it('reaches the row past the first page instead of stopping', async () => {
    ui(<Harness pages={server(7)} />);
    await screen.findByText('x0,x1,x2');
    expect(screen.getByTestId('meta')).toHaveTextContent('3/7+');

    await userEvent.click(screen.getByText('more'));
    await screen.findByText('x0,x1,x2,x3,x4,x5');
    await userEvent.click(screen.getByText('more'));
    await screen.findByText('x0,x1,x2,x3,x4,x5,x6');
    // No trailing '+': the list now knows it is whole, which is what lets a screen show a
    // count it computed itself.
    expect(screen.getByTestId('meta')).toHaveTextContent('7/7');
  });

  it('never renders a page twice while the next one is in flight', async () => {
    /*
     * The trap this hook exists to close. `useAsync` keeps the PREVIOUS answer while the
     * next request runs, so the naive `[...seen, ...data.items]` appended page 1 to itself
     * the instant "load more" was pressed — visible as duplicated rows and duplicate React
     * keys. Holding page 2 open is what makes that window observable at all.
     */
    let releasePageTwo: (() => void) | undefined;
    const pages = vi.fn(async (page: number) => {
      if (page === 2) await new Promise<void>((r) => (releasePageTwo = r));
      return { items: [`x${page}a`, `x${page}b`], total: 4 };
    });
    ui(<Harness pages={pages} />);
    await screen.findByText('x1a,x1b');

    await userEvent.click(screen.getByText('more'));
    expect(screen.getByTestId('rows')).toHaveTextContent('x1a,x1b');
    expect(screen.getByTestId('rows').textContent).not.toContain('x1a,x1b,x1a');

    await act(async () => {
      releasePageTwo?.();
      await Promise.resolve();
    });
    await screen.findByText('x1a,x1b,x2a,x2b');
  });

  it('goes back to page 1 on a new filter, and asks for it exactly once', async () => {
    const pages = server(9);
    ui(<Harness pages={pages} />);
    await screen.findByText('x0,x1,x2');
    await userEvent.click(screen.getByText('more'));
    await screen.findByText('x0,x1,x2,x3,x4,x5');

    pages.mockClear();
    await userEvent.click(screen.getByText('filter'));
    await screen.findByText('x0,x1,x2');
    // One request, for page 1. Resetting the page inside an effect instead would have sent
    // page 2 of the new filter first and then page 1 — two requests and a flash of the
    // wrong rows.
    expect(pages.mock.calls).toEqual([[1]]);
  });
});

describe('CA-2-26 — the depot directory, all of it', () => {
  it('walks every page rather than reading one hundred', async () => {
    get.mockImplementation(pagedServer(250, (i) => ({ id: `d${i}`, name: `Depot ${i}` })));
    const depots = await fetchAllDepots();

    expect(depots).toHaveLength(250);
    expect(depots[249]).toEqual({ id: 'd249', name: 'Depot 249' });
    // The proof that it is paging and not just asking for a bigger number: 100 is the
    // server's own `@Max`, so a single wider request is a 400, not a longer answer.
    expect(get.mock.calls.every(([url]) => paging(url).limit <= 100)).toBe(true);
    expect(get.mock.calls.map(([url]) => paging(url).page)).toEqual([1, 2, 3]);
  });
});

describe('CA-1-16 — the leave approvals queue', () => {
  it('reaches the twenty-first application', async () => {
    get.mockImplementation(
      pagedServer(
        45,
        (i) => ({
          id: `l${i}`,
          employeeName: `Pemohon ${i}`,
          status: 'PENDING_MANAGER',
          type: 'ANNUAL',
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          workingDays: 2,
          reason: 'cuti',
          decisionNote: null,
        }),
        'rows',
      ),
    );
    ui(<LeaveQueuePage />);

    await screen.findByText('Pemohon 0');
    // The heading of the defect: 20 rows, and no page 2 to ask for. The screen now says
    // which is which.
    expect(screen.getByText('Menampilkan 20 dari 45')).toBeTruthy();
    expect(screen.queryByText('Pemohon 20')).toBeNull();

    await userEvent.click(screen.getByText('Muat lebih banyak'));
    await screen.findByText('Pemohon 20');
    expect(screen.getByText('Menampilkan 40 dari 45')).toBeTruthy();
  });
});

describe('CA-2-27 — the franchise application queue buries the newest applicant', () => {
  const app = (i: number) => ({
    id: `a${i}`,
    applicantName: `Pemohon ${i}`,
    applicantPhone: '+628123456789',
    proposedName: `Depot ${i}`,
    city: 'Bandung',
    stage: 'PENDING',
    submittedAt: '2026-08-01T00:00:00.000Z',
  });

  it('shows no pending count until the whole queue is loaded, then the right one', async () => {
    get.mockImplementation(pagedServer(140, app));
    ui(<HqApplicationsPage />);

    await screen.findByText('Pemohon 0');
    // The badge used to read "100 menunggu" whatever the real backlog was, because it
    // counted the slice. A count of part of a queue is not a smaller number, it is a wrong
    // one, so while pages are missing there is no number at all.
    expect(screen.getByText('Menampilkan 100 dari 140')).toBeTruthy();
    expect(screen.queryByText(/menunggu/i)).toBeNull();

    await userEvent.click(screen.getByText('Muat lebih banyak'));
    // Application 139 — the newest, and the one an oldest-first queue of 100 could never
    // reach however long anybody scrolled.
    await screen.findByText('Pemohon 139');
    expect(await screen.findByText(/140 menunggu/)).toBeTruthy();
  });
});

describe('CA-2-28 — the HQ audit trail and its export', () => {
  const entry = (i: number) => ({
    id: `e${i}`,
    actorName: `Aktor ${i}`,
    actorEmail: null,
    actorRole: 'MANAGER',
    target: `target-${i}`,
    action: 'depot.suspend',
    createdAt: '2026-08-30T00:00:00.000Z',
  });

  it('exports every entry, not the hundred on screen', async () => {
    get.mockImplementation(pagedServer(230, entry));
    ui(<HqAuditPage />);
    await screen.findByText('Aktor 0');
    expect(screen.getByText('Menampilkan 100 dari 230')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /ekspor/i }));

    await waitFor(() => expect(downloadXlsx).toHaveBeenCalled());
    const body = downloadXlsx.mock.calls[0]![2];
    /*
     * The serious half of this row. The table showing 100 is a choice; the FILE showing 100
     * is a lie an investigator cannot see, because a spreadsheet has no way to say which
     * rows it is missing. Somebody searches it for the day they care about, finds nothing,
     * and concludes nothing happened.
     */
    expect(body).toHaveLength(230);
    expect(body[229]![0]).toBe('Aktor 229');
  });
});

describe('CA-2-25 — the per-depot revenue export', () => {
  /** dashboard-service's network roll-up: one row per depot, `revenue: null` when the source
   *  report could not account for that depot. */
  const rollup = (order: 'ok' | 'partial') => ({
    from: null,
    to: null,
    depots: Array.from({ length: 40 }, (_, i) => ({
      depotId: `d${i}`,
      code: `DP${i}`,
      name: `Depot ${i}`,
      active: true,
      ownershipType: 'MILIK_SENDIRI',
      revenue: order === 'partial' && i > 9 ? null : 1_000 + i,
      orderCount: order === 'partial' && i > 9 ? null : i,
      slaRate: null,
      avgMinutes: null,
      rating: null,
      lowStockCount: 0,
    })),
    sources: { depot: 'ok', order, delivery: 'ok', inventory: 'ok' },
  });

  // The other two groupings on this screen are untouched by this row; give each the shape
  // it expects so the depot grouping is the only thing under test.
  const route = (order: 'ok' | 'partial') =>
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/dashboard/network')) return Promise.resolve(rollup(order));
      if (u.includes('revenue-by-method')) return Promise.resolve([]);
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 100 });
    });

  it('previews every depot in the network, not the top ten', async () => {
    route('ok');
    ui(<HqReportsExportPage />);
    // `topDepots` is TOP_LIMIT = 10. Depot 39 existing on screen at all is the fix.
    await screen.findByText('Depot 39');

    await userEvent.click(screen.getByRole('button', { name: /ekspor laporan/i }));
    await waitFor(() => expect(downloadXlsx).toHaveBeenCalled());
    expect(downloadXlsx.mock.calls[0]![2].length).toBe(40);
  });

  it('REFUSES the export when the revenue report did not cover every depot', async () => {
    route('partial');
    ui(<HqReportsExportPage />);
    await screen.findByText('Depot 39');

    await userEvent.click(screen.getByRole('button', { name: /ekspor laporan/i }));
    /*
     * Not a warning on the workbook — there is nowhere on a workbook to put one that
     * survives being emailed. The file is not written, and the screen says why. This is the
     * "read everything or refuse" rule, and it is the only rule that holds once the numbers
     * have left the building.
     */
    await waitFor(() => expect(downloadXlsx).not.toHaveBeenCalled());
    expect(screen.getAllByText(/belum lengkap/i).length).toBeGreaterThan(0);
  });
});

describe('CA-2-10 — reconciliation could only be run for the ten biggest depots', () => {
  /** Depot 30 sits far outside any top-ten revenue report; it is the row that read "—". */
  const NETWORK = {
    from: null,
    to: null,
    depots: Array.from({ length: 40 }, (_, i) => ({
      depotId: `d${i}`,
      code: `DP${i}`,
      name: `Depot ${i}`,
      active: true,
      ownershipType: 'WARALABA',
      revenue: 5_000_000 + i,
      orderCount: 10 + i,
      slaRate: null,
      avgMinutes: null,
      rating: null,
      lowStockCount: 0,
    })),
    sources: { depot: 'ok', order: 'ok', delivery: 'ok', inventory: 'ok' },
  };

  it('offers every depot, and settles the one that fell outside the top ten', async () => {
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/dashboard/network')) return Promise.resolve(NETWORK);
      if (u.includes('commission/schemes')) return Promise.resolve([{ depotId: 'd30', pct: 20 }]);
      if (u.includes('settings/schema'))
        return Promise.resolve({ effective: { platformFeePct: 5 } });
      if (u.includes('shipping-by-depot'))
        return Promise.resolve({ items: [{ depotId: 'd30', shippingBilled: 100_000 }] });
      if (u.includes('refunds-by-depot'))
        return Promise.resolve({ items: [{ depotId: 'd30', refunded: 0 }] });
      if (u.includes('gallon')) return Promise.resolve([{ depotId: 'd30', netDeposit: 0 }]);
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 100 });
    });
    ui(<HqReconciliationPage />);

    // Both ceilings at once: the picker listed 100 depots from the directory, and the sales
    // figure came from a TOP-TEN report — so a depot could be selectable and still have no
    // statement at all, because `topDepots` had never heard of it.
    const picker = (await screen.findByLabelText(/pilih depot/i)) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toContain('d30');

    await userEvent.selectOptions(picker, 'd30');
    // A real number where the bug printed a dash — and every row under it (commission,
    // platform fee, net payout) is derived from this one.
    expect(await screen.findByText(/5\.000\.030/)).toBeTruthy();
  });
});

describe('CA-2-40 — the courier load an operator assigns work by', () => {
  it('counts deliveries across every page, not the first hundred', async () => {
    /*
     * The worst shape in this family: not a short list, a WRONG NUMBER that looks right. The
     * load column drives the assign panel, so a courier whose deliveries all sat past row
     * 100 read as idle and the queue handed them more work.
     */
    const DRIVER = 'driver-1';
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/deliveries')) {
        const { page, limit } = paging(u);
        const size = limit || 20;
        const start = (page - 1) * size;
        const rows = Array.from({ length: Math.max(0, Math.min(size, 250 - start)) }, (_, i) => ({
          id: `dl${start + i}`,
          driverId: DRIVER,
          status: 'ON_DELIVERY',
        }));
        return Promise.resolve({ items: rows, total: 250, page, limit: size });
      }
      if (u.includes('drivers'))
        return Promise.resolve([{ id: DRIVER, fullName: 'Kurir Satu', phone: '+628' }]);
      return Promise.resolve({ items: [], total: 0, page: 1, limit: 100 });
    });
    ui(<DashboardOrdersPage />);

    /*
     * Asserted on the REQUESTS rather than on the rendered number, because the load only
     * reaches the screen once an assignable order is selected — and what the fix changes is
     * upstream of that: the count is now built from all 250 deliveries instead of the first
     * 100. Walking every page is the behaviour; the panel is just where it is read.
     */
    await waitFor(() =>
      expect(
        get.mock.calls.filter(([url]) => String(url).includes('/deliveries')).length,
      ).toBeGreaterThan(1),
    );
    const pagesAsked = get.mock.calls
      .filter(([url]) => String(url).includes('/deliveries'))
      .map(([url]) => paging(String(url)).page);
    expect(pagesAsked).toEqual([1, 2, 3]);
  });
});

describe('CA-1-18 — an HR list that stops at 100 under a heading that says 412', () => {
  it('states how much of the roster it is showing, and reaches the rest', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('/departments')
        ? Promise.resolve([])
        : pagedServer(
            412,
            (i) => ({
              id: `e${i}`,
              fullName: `Karyawan ${i}`,
              employeeCode: `K${i}`,
              position: 'Kurir',
              employmentStatus: 'TETAP',
              status: 'ACTIVE',
              departmentId: null,
              authSubjectId: 'a1',
            }),
            'rows',
          )(String(url)),
    );
    ui(<HrEmployeesPage />);

    await screen.findByText('Karyawan 0');
    // The defect in one line: the heading printed the true headcount straight from the
    // server, directly above a hundred rows, and nothing reconciled the two.
    expect(screen.getByText('412 karyawan')).toBeTruthy();
    expect(screen.getByText('Menampilkan 100 dari 412')).toBeTruthy();

    await userEvent.click(screen.getByText('Muat lebih banyak'));
    await screen.findByText('Karyawan 100');
  });
});

describe('CA-1-19 — an employee reading back their own attendance', () => {
  it('does not end at sixty days without saying so', async () => {
    get.mockImplementation(
      pagedServer(
        200,
        (i) => ({
          id: `a${i}`,
          workDate: `2026-0${(i % 9) + 1}-01`,
          checkInAt: null,
          checkOutAt: null,
          status: 'PRESENT',
        }),
        'rows',
      ),
    );
    ui(<MyAttendancePage />);

    // 60 rows is about two months of shifts. This is the screen somebody opens to check a
    // day they think was recorded wrong, which is usually a day on a payslip they have only
    // just been paid for — and often older than two months. It simply ended, mid-career.
    expect(await screen.findByText('Menampilkan 60 dari 200')).toBeTruthy();
    await userEvent.click(screen.getByText('Muat lebih banyak'));
    expect(await screen.findByText('Menampilkan 120 dari 200')).toBeTruthy();
  });
});
