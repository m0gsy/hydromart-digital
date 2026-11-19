// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Loan-of-staff requests (owner, 2026-11-19): depot managers ask, HR decides. The decider now
 * has a door: Pinjam karyawan lists the requests waiting (status REQUESTED), each opening the
 * employee's record where it is decided, and the decision inbox counts them.
 */
const { get, who } = vi.hoisted(() => ({ get: vi.fn(), who: { role: 'HR' } }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: who.role }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'd2', name: 'Depot Dua' }],
    selected: null,
    scopedId: null,
    ready: true,
  }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/hr/depot-picker', () => ({ HrDepotPicker: () => null }));

// hr-service PagedDepotAssignmentResponseDto (modules/dto/depot-assignment.dto.ts:56-59)
const INCOMING = {
  rows: [
    {
      id: 'a1',
      employeeId: 'e1',
      kind: 'LOAN',
      depotId: 'd2',
      startDate: '2026-11-20T00:00:00.000Z',
      endDate: '2026-11-22T00:00:00.000Z',
      status: 'REQUESTED',
      appliedStartAt: null,
      appliedEndAt: null,
      attempts: 0,
      failReason: null,
      createdByRole: 'MANAGER',
      createdBy: 'u9',
      note: null,
      createdAt: '2026-11-19T01:00:00.000Z',
      updatedAt: '2026-11-19T01:00:00.000Z',
    },
  ],
  total: 1,
};

function serve() {
  get.mockImplementation(async (url: string) => {
    if (url.includes('status=REQUESTED')) return INCOMING;
    if (url.includes('/employees/api/v1/employees/e1'))
      return { id: 'e1', fullName: 'Budi Santoso' };
    if (url.includes('requests/mine')) return { rows: [], total: 0 };
    return [];
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the HR row and the page gate take either capability', () => {
  it('the requester and the decider may open Pinjam karyawan; a reader without either may not', async () => {
    const { canOpenRoute } = await import('@/lib/route-access');
    expect(canOpenRoute('/hr/depot-requests', 'MANAGER')).toBe(true); // employeeAssignRequest
    expect(canOpenRoute('/hr/depot-requests', 'HR')).toBe(true); // employeeAssign
    expect(canOpenRoute('/hr/depot-requests', 'FINANCE')).toBe(false);
  });
});

describe('Pinjam karyawan for the decider', () => {
  it("lists what waits, by name, each opening the employee's record", async () => {
    serve();
    who.role = 'HR';
    const { default: Page } = await import('@/app/hr/depot-requests/page');
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/Budi Santoso/)).toBeTruthy());
    expect(screen.getByText(/Depot Dua/)).toBeTruthy();
    expect(screen.getByText('hrFix.depotRequests.decide').closest('a')?.getAttribute('href')).toBe(
      '/hr/employees/detail?id=e1',
    );
    // HR does not request: no form
    expect(screen.queryByText('hrFix.depotRequests.submit')).toBeNull();
  });

  it('the manager keeps the request form and does not see the incoming list', async () => {
    serve();
    who.role = 'MANAGER';
    const { default: Page } = await import('@/app/hr/depot-requests/page');
    render(<Page />);
    expect(screen.getByText('hrFix.depotRequests.submit')).toBeTruthy();
    expect(screen.queryByText('hrFix.depotRequests.incomingTitle')).toBeNull();
  });
});

describe('the decision inbox counts them', () => {
  it('reads the total of the REQUESTED list', async () => {
    serve();
    const { DECISION_QUEUES } = await import('@/lib/decision-queues');
    const q = DECISION_QUEUES.find((x) => x.key === 'depotLoans')!;
    await expect(q.count!('HR', null)).resolves.toBe(1);
    expect(get).toHaveBeenCalledWith(
      '/depot-assignments/api/v1/depot-assignments?status=REQUESTED&pageSize=1',
      true,
    );
  });

  it('is offered to a decider on the web, not in the Ops APK (HR console screens are pruned)', async () => {
    let { queuesFor } = await import('@/lib/decision-queues');
    expect(queuesFor('SUPER_ADMIN').map((q) => q.key)).toContain('depotLoans');
    expect(queuesFor('MANAGER').map((q) => q.key)).not.toContain('depotLoans');
    vi.stubEnv(
      'NEXT_PUBLIC_MOBILE_PRUNED',
      '/hq/*,/hr,/hr/employees/*,/hr/payroll/*,/hr/depot-requests/*',
    );
    vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', 'dashboard,driver,hr,m,resellers,login,products');
    vi.resetModules();
    ({ queuesFor } = await import('@/lib/decision-queues'));
    expect(queuesFor('SUPER_ADMIN').map((q) => q.key)).not.toContain('depotLoans');
  });
});
