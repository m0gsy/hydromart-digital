// @vitest-environment jsdom
/*
 * Five HR screens that asked somebody to decide, or told them something, without the
 * facts the decision needed.
 *
 * CA-1-01  the attendance approval queue named nobody
 * CA-1-02  an asset held by somebody who left read as "dipegang karyawan"
 * CA-1-03  the audit trail showed neither the actor nor what changed
 * CA-1-28  stage-one Approve appeared for roles without `leaveApprove`
 * CA-1-36  HR staff had no link to their own record from the console they work in
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, role } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  role: { current: 'HR' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, ready: true }),
}));
// The assets screen reads the depot switcher to label a row's depot.
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [{ id: 'd-1', code: 'D1', name: 'Depot Satu' }], depotId: 'd-1' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ConfirmProvider } from '@/components/confirm';
import AttendancePage from '@/app/hr/attendance/page';
import AuditPage from '@/app/hr/audit/page';
import LeaveQueuePage from '@/app/hr/leave/page';
import { HrRail } from '@/components/hr/hr-rail';

const page = (rows: unknown[]) => ({ rows, total: rows.length, page: 1, pageSize: 20 });

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ConfirmProvider>{children}</ConfirmProvider>
  </LocaleProvider>
);

beforeEach(() => {
  role.current = 'HR';
  get.mockReset().mockResolvedValue(page([]));
  post.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('the attendance queue names the person (CA-1-01)', () => {
  const row = {
    id: 'a-1',
    employeeId: 'e-1',
    depotId: 'd-1',
    workDate: '2026-08-10',
    checkInAt: '2026-08-10T01:05:00.000Z',
    checkOutAt: '2026-08-10T10:00:00.000Z',
    checkInScore: 0.9,
    checkOutScore: 0.9,
    lateMinutes: 5,
    workingMinutes: 480,
    status: 'PENDING',
  };

  it('shows whose working day is being approved', async () => {
    get.mockResolvedValue(page([{ ...row, employeeName: 'Budi Santoso' }]));

    render(<AttendancePage />, { wrapper: Wrap });

    // Approving a row without this is a decision taken about a person nobody named.
    await waitFor(() => expect(screen.getAllByText('Budi Santoso').length).toBeGreaterThan(0));
  });

  it('says the record was anonymised rather than leaving a blank', async () => {
    get.mockResolvedValue(page([{ ...row, employeeName: null }]));

    render(<AttendancePage />, { wrapper: Wrap });

    await waitFor(() => expect(screen.getAllByText(/dianonimkan/i).length).toBeGreaterThan(0));
  });
});

describe('the audit trail answers who and what (CA-1-03)', () => {
  it('shows the actor and every field that changed', async () => {
    get.mockResolvedValue(
      page([
        {
          id: 'l-1',
          actorId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          action: 'UPDATE',
          entity: 'Employee',
          entityId: 'e-1',
          ip: '10.0.0.1',
          at: '2026-08-10T03:00:00.000Z',
          before: { baseSalary: 5000000, position: 'Kasir' },
          after: { baseSalary: 6000000, position: 'Kasir' },
        },
      ]),
    );

    render(<AuditPage />, { wrapper: Wrap });

    expect(await screen.findByText(/aaaaaaaa/)).toBeTruthy();
    // The unchanged field must not be listed — a diff that lists everything is not a diff.
    expect(screen.getByText(/baseSalary/)).toBeTruthy();
    expect(screen.getByText(/5000000 → 6000000/)).toBeTruthy();
    expect(screen.queryByText(/position/)).toBeNull();
  });
});

describe('stage-one leave approval is offered to the roles that hold it (CA-1-28)', () => {
  const leave = {
    id: 'l-1',
    employeeId: 'e-1',
    employeeName: 'Budi',
    type: 'ANNUAL',
    status: 'PENDING_MANAGER',
    startDate: '2026-08-10',
    endDate: '2026-08-11',
    workingDays: 2,
    reason: 'Acara keluarga',
    decisionNote: null,
  };

  it('offers Approve to HR', async () => {
    get.mockResolvedValue(page([leave]));
    render(<LeaveQueuePage />, { wrapper: Wrap });
    expect(await screen.findByRole('button', { name: /setujui/i })).toBeTruthy();
  });

  it('offers nothing to a role without leaveApprove', async () => {
    // FINANCE can read the HR queues; deciding somebody's leave is not theirs.
    role.current = 'FINANCE';
    get.mockResolvedValue(page([leave]));

    render(<LeaveQueuePage />, { wrapper: Wrap });

    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy());
    // The server refuses them, so the only thing the button could produce was a 403 after
    // the decision had already been made in the reader's head.
    expect(screen.queryByRole('button', { name: /setujui/i })).toBeNull();
  });
});

describe('HR staff can reach their own record (CA-1-36)', () => {
  it('carries a link to /hr/me', () => {
    render(<HrRail />, { wrapper: Wrap });

    const link = screen.getByRole('link', { name: /data saya/i });
    expect(link.getAttribute('href')).toBe('/hr/me');
  });
});

describe('an asset held by somebody who left says so (CA-1-02)', () => {
  const asset = {
    id: 'as-1',
    code: 'LT-001',
    name: 'Laptop',
    type: 'LAPTOP',
    status: 'ASSIGNED',
    depotId: 'd-1',
    holderId: 'e-gone',
    condition: null,
    assignedAt: '2026-01-10T03:00:00.000Z',
  };

  const staff = [
    { id: 'e-here', employeeCode: 'K001', fullName: 'Budi', status: 'ACTIVE', depotId: 'd-1' },
    { id: 'e-gone', employeeCode: 'K002', fullName: 'Sari', status: 'RESIGNED', depotId: 'd-1' },
  ];

  it('names the leaver and marks that they have gone', async () => {
    get.mockImplementation((url: string) => {
      const u = String(url);
      // The route is `/employee-assets/...` — matching on `/assets` alone caught nothing,
      // and an empty list looks exactly like a fix that did not work.
      if (u.includes('employee-assets')) return Promise.resolve(page([asset]));
      if (u.includes('/employees')) {
        /*
         * Honours `status=ACTIVE` on purpose. The bug WAS that filter: asking for active
         * staff and then using the answer to name every holder. A mock that ignores it
         * hands the page the whole roster either way, and the test passes against the
         * defect it exists to catch.
         */
        const rows = u.includes('status=ACTIVE')
          ? staff.filter((e) => e.status === 'ACTIVE')
          : staff;
        return Promise.resolve({ rows, total: rows.length });
      }
      return Promise.resolve(page([]));
    });

    const { default: AssetsPage } = await import('@/app/hr/assets/page');
    render(<AssetsPage />, { wrapper: Wrap });

    // The roster used to be fetched ACTIVE-only, so this row resolved to nobody and read as
    // normal — kit that walked out the door, invisible by construction.
    await waitFor(() =>
      expect(screen.getAllByText(/Sari \(sudah keluar\)/).length).toBeGreaterThan(0),
    );
  });
});

describe('employee filters survive the back button (CA-1-35)', () => {
  it('reads them from the URL and writes them back', async () => {
    window.history.replaceState({}, '', '/hr/employees?q=budi&status=ACTIVE');
    get.mockImplementation((url: string) =>
      String(url).includes('/employees') ? Promise.resolve(page([])) : Promise.resolve(page([])),
    );

    const { default: EmployeesPage } = await import('@/app/hr/employees/page');
    render(<EmployeesPage />, { wrapper: Wrap });

    // The filters come back from the URL, which is what makes them survive a round trip
    // to a detail page and back.
    await waitFor(() =>
      expect((screen.getByPlaceholderText(/cari/i) as HTMLInputElement).value).toBe('budi'),
    );
    const asked = get.mock.calls.map(([u]) => String(u)).find((u) => u.includes('/employees'));
    expect(asked).toContain('search=budi');
    expect(asked).toContain('status=ACTIVE');
  });
});
