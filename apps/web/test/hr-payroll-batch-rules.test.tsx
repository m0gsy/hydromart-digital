// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three HR screens where the API already answered the question and no control asked it.
 *
 *  - CA-1-20: `POST /payroll/generate-batch` was built with a per-employee failure report,
 *    documented as a real response shape so a client could render it, and called by nobody.
 *    Preparing a depot's month meant picking every name in turn from a dropdown.
 *  - CA-1-25: `GET /payroll` accepts `status` and `endpoints.hr.payroll` builds it. There
 *    was no control, so "show me the drafts I still have to approve" was unaskable.
 *  - CA-1-22: `PATCH /bonus-rules/:id` accepts eight fields; the screen only ever sent
 *    `active`. A wrong threshold could not be corrected, only deactivated and re-created.
 */

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
// `ready` matters: /hr/rules sits behind RequireAuth, which renders a spinner until the
// session has resolved — without it the page never gets as far as its own content.
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'depot-1', name: 'Depot Utama' }],
    scopedId: 'depot-1',
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr/payroll',
}));
vi.mock('@/components/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/toast')>('@/components/toast');
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/components/hr/employee-select', () => ({
  EmployeeSelect: () => <select aria-label="employee" />,
}));

import PayrollPage from '@/app/hr/payroll/page';
import RulesPage from '@/app/hr/rules/page';

beforeEach(() => {
  get.mockReset().mockResolvedValue({ rows: [], total: 0, items: [] });
  post.mockReset().mockResolvedValue({ generated: 0, failed: [] });
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('CA-1-25 payroll status filter', () => {
  it('puts the status the API already accepts into the request', async () => {
    render(<PayrollPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    const select = screen.getByText('hrFix.payroll.statusAll').closest('select')!;
    await userEvent.selectOptions(select, 'DRAFT');
    await waitFor(() =>
      expect(get.mock.calls.some(([u]) => String(u).includes('status=DRAFT'))).toBe(true),
    );
  });
});

describe('CA-1-20 depot-wide payroll generation', () => {
  it('calls generate-batch with the chosen depot and the period on screen', async () => {
    render(<PayrollPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    const depotSelect = screen.getByText('hrFix.payroll.batchPickDepot').closest('select')!;
    await userEvent.selectOptions(depotSelect, 'depot-1');
    await userEvent.click(screen.getByText('hrFix.payroll.batchGenerate'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(String(url)).toContain('/payroll/generate-batch');
    expect(body.depotId).toBe('depot-1');
    expect(String(body.periodMonth)).toMatch(/^[0-9]{4}-[0-9]{2}$/);
  });

  it('names the people who got no draft — the half of the answer never rendered', async () => {
    post.mockResolvedValue({
      generated: 4,
      failed: [
        { employeeId: 'e9', name: 'Siti Rahayu', reason: 'Belum ada tarif gaji' },
        { employeeId: 'e10', name: 'Joko Priyono', reason: 'Sudah ada payroll periode ini' },
      ],
    });
    render(<PayrollPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await userEvent.selectOptions(
      screen.getByText('hrFix.payroll.batchPickDepot').closest('select')!,
      'depot-1',
    );
    await userEvent.click(screen.getByText('hrFix.payroll.batchGenerate'));

    await waitFor(() => expect(screen.getByText('Siti Rahayu')).toBeTruthy());
    expect(screen.getByText('Joko Priyono')).toBeTruthy();
    expect(screen.getByText(/Belum ada tarif gaji/)).toBeTruthy();
    expect(screen.getByText('hrFix.payroll.batchFailedCount:2')).toBeTruthy();
  });

  it('says so plainly when nobody was skipped', async () => {
    post.mockResolvedValue({ generated: 6, failed: [] });
    render(<PayrollPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await userEvent.selectOptions(
      screen.getByText('hrFix.payroll.batchPickDepot').closest('select')!,
      'depot-1',
    );
    await userEvent.click(screen.getByText('hrFix.payroll.batchGenerate'));
    await waitFor(() => expect(screen.getByText('hrFix.payroll.batchNoFailures')).toBeTruthy());
  });
});

const RULE = {
  id: 'r1',
  depotId: null,
  bonusType: 'ATTENDANCE',
  name: 'Rajin masuk',
  metric: 'ATTENDANCE_RATE',
  op: 'GTE',
  threshold: 95,
  rewardKind: 'FIXED',
  rewardValue: 200000,
  active: true,
};

describe('CA-1-22 editing a bonus rule', () => {
  it('patches the rule instead of forcing a deactivate-and-recreate', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('bonus-rules') ? Promise.resolve([RULE]) : Promise.resolve({ items: [] }),
    );
    render(<RulesPage />);
    await waitFor(() => expect(screen.getByText('Rajin masuk')).toBeTruthy());

    await userEvent.click(screen.getByText('hrFix.rules.edit'));
    // The form now holds the rule's own values, not an empty create form.
    expect((screen.getByDisplayValue('Rajin masuk') as HTMLInputElement).value).toBe('Rajin masuk');
    expect(screen.getByText('hrFix.rules.editRule:Rajin masuk')).toBeTruthy();

    await userEvent.click(screen.getByText('hrFix.rules.saveChanges'));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const [url, body] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(String(url)).toContain('r1');
    expect(body.threshold).toBe(95);
    expect(body.name).toBe('Rajin masuk');
    // A rule's depot is what makes it a different rule; moving one silently would
    // re-target money already reasoned about.
    expect(body).not.toHaveProperty('depotId');
    // And nothing was created.
    expect(post).not.toHaveBeenCalled();
  });

  it('goes back to creating when the edit is cancelled', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('bonus-rules') ? Promise.resolve([RULE]) : Promise.resolve({ items: [] }),
    );
    render(<RulesPage />);
    await waitFor(() => expect(screen.getByText('Rajin masuk')).toBeTruthy());
    await userEvent.click(screen.getByText('hrFix.rules.edit'));
    await userEvent.click(screen.getByText('hrFix.rules.cancelEdit'));
    expect(screen.queryByDisplayValue('Rajin masuk')).toBeNull();
    expect(screen.getAllByText('hrFix.rules.addRule').length).toBeGreaterThan(0);
  });
});
