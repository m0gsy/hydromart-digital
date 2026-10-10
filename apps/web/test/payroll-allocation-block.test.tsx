// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A payslip carried by two depots says so, and says how much each carries. A slip carried by
 * one depot (every slip today) shows nothing extra.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

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
  useAuth: () => ({ customer: { id: 'u1', role: 'HR' }, ready: true }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    depots: [
      { id: 'dep-g', name: 'Galaksi' },
      { id: 'dep-p', name: 'Pekayon' },
    ],
    scopedId: 'dep-g',
    ready: true,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'pay-1' }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), askReason: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr/payroll/detail',
  useSearchParams: () => new URLSearchParams(),
}));

import PayrollDetailPage from '@/app/hr/payroll/detail/page';

const slip = (shares?: unknown[]) => ({
  id: 'pay-1',
  employeeId: 'e1',
  employeeName: 'Budi',
  periodMonth: '2026-09',
  status: 'DRAFT',
  gross: '3000000',
  totalBonus: '0',
  totalDeduction: '0',
  net: '3000000',
  presentDays: 30,
  items: [{ id: 'i1', kind: 'BASE', label: 'Gaji pokok', amount: '3000000' }],
  ...(shares ? { shares } : {}),
});

beforeEach(() => get.mockReset());

describe('payroll slip allocation block', () => {
  it('names each depot with its days and its part when the slip is split', async () => {
    get.mockResolvedValue(
      slip([
        { depotId: 'dep-g', days: 20, gross: 2000000, bonus: 0, deduction: 0, shortfall: 0, net: 2000000 },
        { depotId: 'dep-p', days: 10, gross: 1000000, bonus: 0, deduction: 0, shortfall: 0, net: 1000000 },
      ]),
    );
    render(<PayrollDetailPage />);
    expect(await screen.findByText('hrFix.payrollDetail.allocation')).toBeInTheDocument();
    expect(screen.getByText(/Galaksi/)).toBeInTheDocument();
    expect(screen.getByText(/Pekayon/)).toBeInTheDocument();
    expect(screen.getByText(/hrFix\.payrollDetail\.allocationDays:20/)).toBeInTheDocument();
  });

  it('falls back to a short id for a depot the console cannot name', async () => {
    get.mockResolvedValue(
      slip([
        { depotId: 'dep-g', days: 20, gross: 2, bonus: 0, deduction: 0, shortfall: 0, net: 2 },
        { depotId: 'unknown-depot-id', days: 10, gross: 1, bonus: 0, deduction: 0, shortfall: 0, net: 1 },
      ]),
    );
    render(<PayrollDetailPage />);
    expect(await screen.findByText(/unknown-/)).toBeInTheDocument();
  });

  it('shows nothing extra for an ordinary slip, or a slip with a single carrier', async () => {
    get.mockResolvedValue(slip());
    const first = render(<PayrollDetailPage />);
    await waitFor(() => expect(screen.getByText('Gaji pokok')).toBeInTheDocument());
    expect(screen.queryByText('hrFix.payrollDetail.allocation')).toBeNull();
    first.unmount();

    get.mockResolvedValue(
      slip([{ depotId: 'dep-g', days: 30, gross: 3, bonus: 0, deduction: 0, shortfall: 0, net: 3 }]),
    );
    render(<PayrollDetailPage />);
    await waitFor(() => expect(screen.getByText('Gaji pokok')).toBeInTheDocument());
    expect(screen.queryByText('hrFix.payrollDetail.allocation')).toBeNull();
  });
});
