// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Six HR screens with copy a translator could not reach.
 *
 * Each one is a single line that was typed out instead of keyed, and each sat beside a
 * sibling that WAS keyed — which is why they survived: the line above them looked right.
 *
 *  - CA-1-83: the advance card carried its own untranslated status words AND its own
 *    palette. "Lunas" was `neutral` here and `success` on /hr/loans, so one fact about one
 *    advance looked different depending on which screen was open.
 *  - CA-1-84: `HR_ROLE_LABEL` holds dictionary KEYS, and the takeover warning printed one
 *    raw — "hq.roles.STAFF_DEPOT akan…".
 *  - CA-1-85: the score label, the compute button, and BOTH save-failure toasts.
 *  - CA-1-86: the scope selector on the screen that decides whether a number binds one
 *    depot or the whole network offered "GLOBAL" and "DEPOT" — database values.
 *  - CA-1-87: a dashboard heading, beside a `nav.payroll` key that has always existed.
 *  - CA-1-88: "dari" went through the dictionary; "ke" and "kondisi" on the same line did not.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'e1' }));
vi.mock('@/components/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/toast')>('@/components/toast');
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [{ id: 'depot-1', code: 'DP1', name: 'Depot Utama' }],
    scopedId: 'depot-1',
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));

import { EmployeeLoans } from '@/components/hr/employee-loans';
import HrSettingsPage from '@/app/hr/settings/page';

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe('CA-1-83 the advance card', () => {
  const loan = (over: Record<string, unknown>) => ({
    id: 'l1',
    employeeId: 'e1',
    principal: 1000000,
    installmentAmount: 250000,
    startPeriod: '2026-01',
    remaining: 500000,
    note: null,
    active: true,
    settled: false,
    ...over,
  });

  it('names each of the three states through the dictionary', async () => {
    get.mockResolvedValue([loan({ settled: true })]);
    render(<EmployeeLoans employeeId="e1" isAdmin />);
    await waitFor(() => expect(screen.getByText('hrFix.loans.settled')).toBeTruthy());
    // The words that used to be typed into the component.
    expect(screen.queryByText('Lunas')).toBeNull();
  });

  it('distinguishes a stopped advance from a running one', async () => {
    get.mockResolvedValue([loan({ active: false })]);
    render(<EmployeeLoans employeeId="e1" isAdmin />);
    await waitFor(() => expect(screen.getByText('hrFix.loans.stopped')).toBeTruthy());
    expect(screen.queryByText('Dihentikan')).toBeNull();
  });

  it('reuses the terms wording from /hr/loans rather than a second copy', async () => {
    get.mockResolvedValue([loan({})]);
    render(<EmployeeLoans employeeId="e1" isAdmin />);
    await waitFor(() => expect(screen.getByText(/hrFix\.loans\.terms:2026-01/)).toBeTruthy());
    expect(screen.getByText(/hrFix\.loans\.remaining/)).toBeTruthy();
    expect(screen.queryByText(/Cicilan/)).toBeNull();
  });
});

describe('CA-1-86 the settings scope selector', () => {
  beforeEach(() => {
    get.mockResolvedValue({ defs: [{ key: 'k1', label: 'K1', type: 'int', unit: 'hari' }], effective: { k1: 3 } });
  });

  it('offers the two scopes in words, not as database values', async () => {
    render(<HrSettingsPage />);
    await waitFor(() => expect(screen.getByText('hrFix.settings.scopeOptionGlobal')).toBeTruthy());
    expect(screen.getByText('hrFix.settings.scopeOptionDepot')).toBeTruthy();
    // The screen decides whether a number binds one depot or the whole network; it should
    // not ask that question in column values.
    expect(screen.queryByText('GLOBAL')).toBeNull();
    expect(screen.queryByText('DEPOT')).toBeNull();
  });

  it('labels the selector and the two hints beneath each setting', async () => {
    render(<HrSettingsPage />);
    await waitFor(() => expect(screen.getByText('hrFix.settings.scopeLabel')).toBeTruthy());
    expect(screen.getByText(/hrFix\.settings\.formatLabel/)).toBeTruthy();
    expect(screen.getByText(/hrFix\.settings\.effectiveLabel/)).toBeTruthy();
  });
});
