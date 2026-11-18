// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-2b of the flow plan: on the HR screens the employee's name opens their record, a payroll
 * warning opens what it is warning about, and every detail screen has its way back to the list
 * — a link, because one opened from a push has no history to go back through.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const who = { role: 'HR' };

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
  getBlob: vi.fn(),
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: who.role }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr/payroll/detail',
  useSearchParams: () => new URLSearchParams('id=pr-1'),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'pr-1', useQueryState: () => ['', vi.fn()] }));
vi.mock('@/components/toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/toast')>('@/components/toast');
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ depots: [], scopedId: null, ready: true, error: null, reload: vi.fn() }),
}));

import { entityHref } from '@/lib/entity-href';
import PayrollDetailPage from '@/app/hr/payroll/detail/page';

const PAYROLL = {
  id: 'pr-1',
  employeeId: 'e1',
  employeeName: 'Budi',
  periodMonth: '2026-11',
  status: 'DRAFT',
  gross: 4250000,
  net: 4000000,
  totalBonus: 0,
  totalDeduction: 250000,
  presentDays: 20,
  pendingDays: 2,
  ptkpMissing: true,
  createdAt: '2026-11-18T00:00:00.000Z',
  approvedAt: null,
  paidAt: null,
  items: [],
};
const hrefOf = (text: string) => screen.getByText(text).closest('a')?.getAttribute('href') ?? null;

beforeEach(() => {
  who.role = 'HR';
  get.mockReset().mockResolvedValue(PAYROLL);
});
afterEach(() => vi.clearAllMocks());

describe('entityHref: employee', () => {
  it('opens the HR record for a role that reads HR, and nothing for one that does not', () => {
    expect(entityHref('employee', 'e1', 'hq', 'HR')).toBe('/hr/employees/detail?id=e1');
    expect(entityHref('employee', 'e1', 'hq', 'CUSTOMER')).toBeNull();
  });
});

describe('payroll detail', () => {
  it('names the employee as a door, and each warning opens what it is about', async () => {
    render(<PayrollDetailPage />);
    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy());
    expect(hrefOf('Budi')).toBe('/hr/employees/detail?id=e1');
    expect(hrefOf('hrFix.payrollDetail.pendingWarning:2')).toBe('/hr/attendance?employeeId=e1');
    expect(hrefOf('hrFix.payrollDetail.ptkpMissing')).toBe('/hr/employees/detail/edit?id=e1');
    expect(hrefOf('hrFix.common.back')).toBe('/hr/payroll');
  });

  it('a role that runs payroll but may not edit employees gets the PTKP warning as text', async () => {
    who.role = 'FINANCE';
    render(<PayrollDetailPage />);
    await waitFor(() => expect(screen.getByText('hrFix.payrollDetail.ptkpMissing')).toBeTruthy());
    expect(hrefOf('hrFix.payrollDetail.ptkpMissing')).toBeNull();
  });
});
