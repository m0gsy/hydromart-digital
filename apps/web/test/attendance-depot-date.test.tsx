// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Owner, 27 Nov 2026: the Absensi menu names the depot on every row, opens on one day (today)
 * with a step back and forward, keeps a range for the links that name one, and filters by depot.
 * The same screen ships inside the Ops app, so it has to work at phone width too.
 */

const { get, search } = vi.hoisted(() => ({
  get: vi.fn(),
  search: { current: new URLSearchParams() },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  getBlob: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr/attendance',
  useSearchParams: () => search.current,
}));
vi.mock('@/components/hr/employee-select', () => ({ EmployeeSelect: () => <div /> }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [
      { id: 'd-1', code: 'BKS-01', name: 'Galaxy Bekasi' },
      { id: 'd-2', code: 'BKS-02', name: 'Pekayon' },
    ],
    ready: true,
    error: null,
  }),
}));
// "Today" pinned, so the day the screen opens on is a fact of the test, not of the clock.
vi.mock('@/lib/wib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wib')>()),
  todayWib: () => '2026-11-27',
}));

import AttendancePage from '@/app/hr/attendance/page';
import { ConfirmProvider } from '@/components/confirm';

const mount = () =>
  render(
    <ConfirmProvider>
      <AttendancePage />
    </ConfirmProvider>,
  );

const ROW = {
  id: 'a1',
  employeeId: 'e1',
  depotId: 'd-1',
  workDate: '2026-11-27',
  checkInAt: '2026-11-27T01:00:00.000Z',
  checkOutAt: null,
  checkInScore: 0.9,
  checkOutScore: null,
  lateMinutes: 0,
  workingMinutes: null,
  status: 'PRESENT',
  employeeName: 'Budi Santoso',
};

let pending: unknown[] = [];
let rows: unknown[] = [ROW];

/** The query of every request for the main list (not the PENDING queue, not a trail). */
const listQueries = () =>
  get.mock.calls
    .map((c) => String(c[0]))
    .filter((p) => p.startsWith('/attendance/api/v1/attendance?') && !p.includes('status=PENDING'))
    .map((p) => new URL(p, 'http://x').searchParams);
const lastList = () => listQueries().at(-1)!;
// The label wraps the select, so its text runs on into the options: matched by its start.
const depotSelect = () => screen.getByLabelText(/^hrFix\.attendance\.depot/);

beforeEach(() => {
  search.current = new URLSearchParams();
  pending = [];
  rows = [ROW];
  get.mockReset().mockImplementation((path: string) =>
    Promise.resolve(
      path.includes('status=PENDING')
        ? { rows: pending, total: pending.length }
        : path.includes('/adjustments')
          ? []
          : { rows, total: rows.length },
    ),
  );
});

describe('the day the menu opens on', () => {
  it('asks for today, and only today', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Budi Santoso')).toBeTruthy());
    expect(lastList().get('from')).toBe('2026-11-27');
    expect(lastList().get('to')).toBe('2026-11-27');
    expect(lastList().has('depotId')).toBe(false);
  });

  it('steps one day back and forward, across a month end', async () => {
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole('button', { name: 'hrFix.attendance.prevDay' }));
    await waitFor(() => expect(lastList().get('from')).toBe('2026-11-26'));
    expect(lastList().get('to')).toBe('2026-11-26');

    await userEvent.click(screen.getByRole('button', { name: 'hrFix.attendance.nextDay' }));
    await userEvent.click(screen.getByRole('button', { name: 'hrFix.attendance.nextDay' }));
    await waitFor(() => expect(lastList().get('from')).toBe('2026-11-28'));

    // The filter's date box comes before the manual-entry one, which shares its label.
    fireEvent.change(screen.getAllByLabelText('hrFix.attendance.date')[0]!, {
      target: { value: '2026-03-01' },
    });
    await waitFor(() => expect(lastList().get('from')).toBe('2026-03-01'));
    await userEvent.click(screen.getByRole('button', { name: 'hrFix.attendance.prevDay' }));
    await waitFor(() => expect(lastList().get('from')).toBe('2026-02-28'));
  });

  it('keeps its day when the box is cleared, instead of asking for every day', async () => {
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByLabelText('hrFix.attendance.date')[0]!, {
      target: { value: '' },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(listQueries().every((q) => q.get('from') === '2026-11-27')).toBe(true);
  });
});

describe('the depot', () => {
  it('names the depot on every row: by name, "lintas depot" for none, short id when unknown', async () => {
    rows = [
      ROW,
      { ...ROW, id: 'a2', employeeName: 'Sari', depotId: null },
      { ...ROW, id: 'a3', employeeName: 'Joko', depotId: '9f8e7d6c-0000-4000-8000-000000000000' },
    ];
    mount();
    await waitFor(() => expect(screen.getByText('Sari')).toBeTruthy());
    expect(screen.getByText('Galaxy Bekasi')).toBeTruthy();
    expect(screen.getByText('hrFix.attendance.noDepot')).toBeTruthy();
    expect(screen.getByText('9f8e7d6c')).toBeTruthy();
  });

  it('names it in the approval queue too', async () => {
    pending = [{ ...ROW, id: 'p1', status: 'PENDING', depotId: 'd-2', employeeName: 'Rina' }];
    rows = [];
    mount();
    await waitFor(() => expect(screen.getByText('Rina')).toBeTruthy());
    // The main list is empty and the picker option reads "Pekayon · BKS-02": this is the queue row.
    expect(screen.getByText('Pekayon')).toBeTruthy();
  });

  it('narrows the list to one depot, and back to all', async () => {
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));

    await userEvent.selectOptions(depotSelect(), 'd-2');
    await waitFor(() => expect(lastList().get('depotId')).toBe('d-2'));
    // Still the day: the depot narrows the day, it does not replace it.
    expect(lastList().get('from')).toBe('2026-11-27');

    await userEvent.selectOptions(depotSelect(), '');
    await waitFor(() => expect(lastList().has('depotId')).toBe(false));
  });

  it('leaves the approval queue unfiltered: it is the work waiting on HR', async () => {
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    await userEvent.selectOptions(depotSelect(), 'd-2');
    await waitFor(() => expect(lastList().get('depotId')).toBe('d-2'));
    const queue = get.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('status=PENDING'));
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((p) => !p.includes('depotId') && !p.includes('from='))).toBe(true);
  });
});

describe('the range', () => {
  it('starts on the day it was switched from', async () => {
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: 'hrFix.attendance.modeRange' }));
    expect((screen.getByLabelText('hrFix.attendance.from') as HTMLInputElement).value).toBe('2026-11-27');
    expect((screen.getByLabelText('hrFix.attendance.to') as HTMLInputElement).value).toBe('2026-11-27');

    fireEvent.change(screen.getByLabelText('hrFix.attendance.from'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(lastList().get('from')).toBe('2026-11-01'));
    expect(lastList().get('to')).toBe('2026-11-27');
  });

  it('refuses an end before the start in words, and sends nothing', async () => {
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: 'hrFix.attendance.modeRange' }));
    const before = listQueries().length;

    fireEvent.change(screen.getByLabelText('hrFix.attendance.to'), { target: { value: '2026-11-01' } });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('hrFix.attendance.badRange'));
    expect(listQueries().length).toBe(before);
    // No "nothing here" under it: the list was not asked, so it has nothing to report.
    expect(screen.queryByText('hrFix.attendance.empty')).toBeNull();
  });

  it('refuses a window wider than hr-service accepts', async () => {
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: 'hrFix.attendance.modeRange' }));
    const before = listQueries().length;

    // 366 days exactly is allowed…
    fireEvent.change(screen.getByLabelText('hrFix.attendance.from'), { target: { value: '2025-11-26' } });
    await waitFor(() => expect(lastList().get('from')).toBe('2025-11-26'));
    // …a day more is not.
    fireEvent.change(screen.getByLabelText('hrFix.attendance.from'), { target: { value: '2025-11-25' } });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('hrFix.attendance.rangeTooLong:366'),
    );
    expect(listQueries().length).toBe(before + 1);
  });

  it("opens an employee's history on everything, as it always did", async () => {
    search.current = new URLSearchParams('employeeId=e-9');
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    expect(lastList().get('employeeId')).toBe('e-9');
    expect(lastList().has('from')).toBe(false);
    expect(lastList().has('to')).toBe(false);
    expect((screen.getByLabelText('hrFix.attendance.from') as HTMLInputElement).value).toBe('');
  });

  it("opens a payroll slip's window on that window (PR-2b)", async () => {
    search.current = new URLSearchParams('employeeId=e-9&from=2026-10-01&to=2026-10-31');
    mount();
    await waitFor(() => expect(listQueries().length).toBeGreaterThan(0));
    expect(lastList().get('from')).toBe('2026-10-01');
    expect(lastList().get('to')).toBe('2026-10-31');
  });
});

describe('a held punch in the main list', () => {
  it('shows its status instead of a correction select that would read "Hadir"', async () => {
    rows = [{ ...ROW, status: 'PENDING' }];
    mount();
    await waitFor(() => expect(screen.getByText('Budi Santoso')).toBeTruthy());
    expect(screen.queryByLabelText('hrFix.attendance.correctStatus')).toBeNull();
    expect(screen.getByText('hrFix.map.attendance.PENDING')).toBeTruthy();
  });

  it('still offers the correction on a decided day', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Budi Santoso')).toBeTruthy());
    expect(
      (screen.getByLabelText('hrFix.attendance.correctStatus') as HTMLSelectElement).value,
    ).toBe('PRESENT');
  });
});
