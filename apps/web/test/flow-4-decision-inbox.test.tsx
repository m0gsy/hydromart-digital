// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-4 of the flow plan: one card, "Menunggu keputusan Anda", on /dashboard/approvals and
 * /m/manager/approvals: every other queue the role decides and this binary serves. Each queue
 * has its own adapter; a count is read only from an answer that carries a total. Leave ships
 * in the Ops APK so a manager can decide it from the phone.
 */
const { get, who } = vi.hoisted(() => ({ get: vi.fn(), who: { role: 'MANAGER' } }));

vi.mock('@/lib/api', () => ({ api: { get, getCached: get }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: who.role }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], selected: null, scopedId: 'd1', ready: true }),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
  translate: (k: string) => k,
}));

// Answers copied from each owning service's DTO (shape and field names as the service sends).
// hr-service PagedLoanRequestResponseDto (modules/dto/responses.generated.dto.ts:808-813)
const LOAN_PAGE = {
  rows: [
    {
      id: 'u1',
      employeeId: 'e1',
      depotId: 'd1',
      amount: '500000',
      reason: 'Biaya sekolah',
      status: 'PENDING',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      loanId: null,
      createdAt: '2026-11-17T02:00:00.000Z',
      updatedAt: '2026-11-17T02:00:00.000Z',
      employeeName: 'Budi',
      employeeCode: 'EMP-014',
      dueAt: '2026-11-20T02:00:00.000Z',
      overdue: false,
    },
  ],
  total: 4,
};
// hr-service LeaveService.list (application/services/leave.service.ts:263-276)
const LEAVE_PAGE = {
  rows: [
    {
      id: 'l1',
      employeeId: 'e1',
      depotId: 'd1',
      type: 'SICK',
      startDate: '2026-11-20T00:00:00.000Z',
      endDate: '2026-11-21T00:00:00.000Z',
      workingDays: 2,
      reason: 'Demam',
      attachmentUrl: null,
      status: 'PENDING_MANAGER',
      managerDecidedBy: null,
      managerDecidedAt: null,
      hrDecidedBy: null,
      hrDecidedAt: null,
      decisionNote: null,
      createdAt: '2026-11-19T01:00:00.000Z',
      updatedAt: '2026-11-19T01:00:00.000Z',
      employeeName: 'Siti',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 1,
};
// payout-service PagedExpenseClaimResponseDto (modules/dto/responses.generated.dto.ts:285-296)
const EXPENSE_PAGE = {
  items: [
    {
      id: 'x1',
      courierId: 'c1',
      depotId: 'd1',
      category: 'FUEL',
      amount: 25000,
      description: 'Bensin',
      receiptUrl: null,
      status: 'PENDING',
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      ledgerEntryId: null,
      createdAt: '2026-11-19T01:00:00.000Z',
      updatedAt: '2026-11-19T01:00:00.000Z',
    },
  ],
  total: 0,
  page: 1,
  limit: 1,
  totalPages: 0,
};

function serveQueues() {
  get.mockImplementation(async (url: string) => {
    // hr-service DecidableCountResponseDto (modules/dto/loan-request.dto.ts)
    if (url.includes('/loan-requests/pending/decidable-count')) return { total: 4 };
    if (url.startsWith('/loan-requests/')) return LOAN_PAGE;
    if (url.startsWith('/leave/')) return LEAVE_PAGE;
    if (url.startsWith('/payout/api/v1/expenses')) return EXPENSE_PAGE;
    throw new Error(`unexpected ${url}`);
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('each adapter reads its own answer', () => {
  it('leave and expense claims count from the total their list carries', async () => {
    serveQueues();
    const { DECISION_QUEUES } = await import('@/lib/decision-queues');
    const by = (k: string) => DECISION_QUEUES.find((q) => q.key === k)!;
    await expect(by('kasbon').count!('MANAGER', 'd1')).resolves.toBe(4);
    await expect(by('leave').count!('MANAGER', 'd1')).resolves.toBe(2);
    await expect(by('expenses').count!('MANAGER', 'd1')).resolves.toBe(0);
  });

  it('expense claims are counted at the depot the claims screen lists, and not without one', async () => {
    serveQueues();
    const { DECISION_QUEUES } = await import('@/lib/decision-queues');
    const expenses = DECISION_QUEUES.find((q) => q.key === 'expenses')!;
    await expenses.count!('MANAGER', 'd1');
    expect(get).toHaveBeenCalledWith(
      '/payout/api/v1/expenses?status=PENDING&limit=1&depotId=d1',
      true,
    );
    await expect(expenses.count!('MANAGER', null)).rejects.toThrow();
  });

  it('leave asks for the stage the role decides', async () => {
    serveQueues();
    const { DECISION_QUEUES } = await import('@/lib/decision-queues');
    const leave = DECISION_QUEUES.find((q) => q.key === 'leave')!;
    await leave.count!('MANAGER', 'd1');
    await leave.count!('HR', 'd1');
    const asked = get.mock.calls.map(([u]) => String(u));
    expect(asked).toContain('/leave/api/v1/leave?status=PENDING_MANAGER&pageSize=1');
    expect(asked).toContain('/leave/api/v1/leave?status=PENDING_HR&pageSize=1');
  });

  it('a list with no total offers no count', async () => {
    const { DECISION_QUEUES } = await import('@/lib/decision-queues');
    for (const key of ['payouts', 'franchiseApplications', 'dataRequests'])
      expect(DECISION_QUEUES.find((q) => q.key === key)!.count).toBeUndefined();
  });
});

describe('which queues a role is shown', () => {
  it('a depot manager: kasbon, leave and expense claims; a courier: none', async () => {
    const { queuesFor } = await import('@/lib/decision-queues');
    expect(queuesFor('MANAGER').map((q) => q.key)).toEqual(['kasbon', 'leave', 'expenses']);
    expect(queuesFor('STAFF_DEPOT')).toEqual([]);
  });

  it('the super admin sees the head-office queues on the web, not in the Ops APK', async () => {
    let { queuesFor } = await import('@/lib/decision-queues');
    expect(queuesFor('SUPER_ADMIN').map((q) => q.key)).toEqual(
      expect.arrayContaining(['payouts', 'franchiseApplications', 'dataRequests']),
    );
    vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', '/hq/*,/hr,/hr/employees/*,/hr/payroll/*');
    vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', 'dashboard,driver,hr,m,resellers,login,products');
    vi.resetModules();
    ({ queuesFor } = await import('@/lib/decision-queues'));
    const ops = queuesFor('SUPER_ADMIN').map((q) => q.key);
    expect(ops).not.toContain('payouts');
    // leave ships in the Ops APK now (PR-4), so it is decidable from the phone
    expect(ops).toContain('leave');
  });
});

describe('the light gate is the real gate', () => {
  const ROLES = [
    'STAFF_DEPOT',
    'KEPALA_DEPOT',
    'ASSISTANT_SUPERVISOR',
    'SUPERVISOR',
    'MANAGER',
    'DIREKTUR',
    'FRANCHISE_OWNER',
    'HEAD_OFFICE',
    'FINANCE',
    'HR',
    'MARKETING',
    'SUPER_ADMIN',
  ];
  it.each([
    ['web', '', ''],
    [
      'ops',
      '/hq/*,/hr,/hr/employees/*,/hr/payroll/*',
      'dashboard,driver,hr,m,resellers,login,products',
    ],
  ])(
    '%s: every role gets exactly the queues canOpenRoute would allow',
    async (_b, pruned, segments) => {
      vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', pruned);
      vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', segments);
      vi.resetModules();
      const { DECISION_QUEUES, queuesFor } = await import('@/lib/decision-queues');
      const { canOpenRoute } = await import('@/lib/route-access');
      for (const role of ROLES)
        expect(queuesFor(role).map((q) => q.key)).toEqual(
          DECISION_QUEUES.filter((q) => q.decides(role) && canOpenRoute(q.href, role)).map(
            (q) => q.key,
          ),
        );
    },
  );

  it('keeps route-access (every rail and its icons) out of the screens that carry the card or a form button', () => {
    for (const f of [
      'src/lib/decision-queues.ts',
      'src/app/hq/campaigns/page.tsx',
      'src/app/hq/reconciliation/page.tsx',
    ])
      expect(readFileSync(join(process.cwd(), f), 'utf8')).not.toContain(
        "from '@/lib/route-access'",
      );
  });
});

describe('the card', () => {
  it('names each queue, with its count, as a door to where it is decided', async () => {
    serveQueues();
    who.role = 'MANAGER';
    const { DecisionInbox } = await import('@/components/dashboard/decision-inbox');
    render(<DecisionInbox />);
    expect(screen.getByText('opsFix.inbox.title')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('2')).toBeTruthy());
    expect(screen.getByText('0')).toBeTruthy();
    // kasbon counts only what this manager may decide (K1/K2, server-side)
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('ops.nav.hrLoans').closest('a')?.textContent).toContain('4');
    expect(screen.getByText('ops.nav.hrLeave').closest('a')?.getAttribute('href')).toBe(
      '/hr/leave',
    );
  });

  it('a queue whose count cannot be read says Buka, never 0', async () => {
    get.mockRejectedValue(new Error('down'));
    who.role = 'MANAGER';
    const { DecisionInbox } = await import('@/components/dashboard/decision-inbox');
    render(<DecisionInbox />);
    await waitFor(() => expect(screen.getAllByText('opsFix.inbox.open')).toHaveLength(3));
  });

  it('is on both approvals screens', () => {
    for (const page of ['dashboard/approvals', 'm/manager/approvals'])
      expect(readFileSync(join(process.cwd(), 'src/app', page, 'page.tsx'), 'utf8')).toContain(
        '<DecisionInbox />',
      );
  });
});

describe('leave in the Ops APK', () => {
  it('is kept by the Ops build and asserted in its surface', () => {
    const build = readFileSync(join(process.cwd(), 'scripts/build-mobile.mjs'), 'utf8');
    expect(build).toContain("['me', 'loans', 'attendance', 'leave']");
    expect(build).toMatch(/serves: \[[\s\S]*'hr\/leave',[\s\S]*withholds/);
  });
});
