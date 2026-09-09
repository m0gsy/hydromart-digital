// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-1-47 — an expiry date nobody ever read.
 *
 * HR typed `expiresAt` when it filed a document, the employee's own page printed it back,
 * and that was the entire life of the field. No screen and no query ever asked which
 * documents were about to stop being valid, so finding out meant opening every employee one
 * at a time — an errand nobody had a reason to run. A courier's driving licence lapsed the
 * same way a contract did: silently, until a policeman or an audit noticed.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}:${Object.values(v).join('/')}` : k),
    locale: 'id',
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hr',
  useSearchParams: () => new URLSearchParams(),
}));

import HrDashboardPage from '@/app/hr/page';

const BASE = {
  depotId: null,
  periodMonth: '2026-07',
  workDate: '2026-07-01',
  headcount: { total: 3, byStatus: [], byEmploymentStatus: [] },
  attendanceToday: [],
  payroll: {
    totals: { gross: 0, totalBonus: 0, totalDeduction: 0, net: 0, count: 0 },
    byStatus: [],
  },
  employmentsEnding: [
    {
      employeeId: 'e-3',
      employeeCode: 'HR-0003',
      fullName: 'Rina Wijaya',
      employmentStatus: 'PROBATION',
      contractEndDate: '2026-06-25',
    },
    {
      employeeId: 'e-4',
      employeeCode: 'HR-0004',
      fullName: 'Agus Salim',
      employmentStatus: 'PERMANENT',
      contractEndDate: '2026-07-21',
    },
  ],
  documentsExpiring: [
    {
      employeeId: 'e-1',
      employeeCode: 'HR-0001',
      fullName: 'Budi Santoso',
      type: 'SIM',
      expiresAt: '2026-06-20',
    },
    {
      employeeId: 'e-2',
      employeeCode: 'HR-0002',
      fullName: 'Sri Lestari',
      type: 'CONTRACT',
      expiresAt: '2026-07-11',
    },
  ],
};

function mount(dashboard: unknown) {
  get.mockReset().mockResolvedValue(dashboard);
  render(<HrDashboardPage />);
}

describe('CA-1-47 the HR dashboard says which documents are about to lapse', () => {
  beforeEach(() => get.mockReset());

  it('names the employee, the document, and its date', async () => {
    mount(BASE);
    await waitFor(() => expect(screen.getByText('Budi Santoso')).toBeTruthy());
    // The document type a human reads, not the enum, and the date it stops being valid.
    expect(screen.getByText(/hrFix\.map\.docType\.SIM/)).toBeTruthy();
    expect(screen.getByText(/2026-06-20/)).toBeTruthy();
    expect(screen.getByText('Sri Lestari')).toBeTruthy();
  });

  it('separates one that is already past from one that still has time', async () => {
    mount(BASE);
    // 2026-06-20 is before the server's own workDate of 2026-07-01.
    await waitFor(() => expect(screen.getByText('hrFix.home.docsExpired')).toBeTruthy());
    // …and 2026-07-11 is ten days after it.
    expect(screen.getByText('hrFix.home.docsDaysLeft:10')).toBeTruthy();
  });

  it('leads to the employee whose document it is', async () => {
    mount(BASE);
    const link = await screen.findByRole('link', { name: 'Budi Santoso' });
    expect(link.getAttribute('href')).toBe('/hr/employees/detail?id=e-1');
  });

  /*
   * CA-1-43 — the same shape, for the other thing that runs out silently. A contract that
   * ended last month looked exactly like one with two years left, because `contractEndDate`
   * is deliberately not a status and so had no reader at all.
   */
  it('names the contract that has already run out, and the one that has not', async () => {
    mount(BASE);
    await waitFor(() => expect(screen.getByText('Rina Wijaya')).toBeTruthy());

    expect(screen.getByText('hrFix.home.contractOver')).toBeTruthy();
    // 2026-07-21 is twenty days after the server's own workDate.
    expect(screen.getByText('hrFix.home.docsDaysLeft:20')).toBeTruthy();
    expect(screen.getByText(/HR-0003/)).toBeTruthy();
  });

  it('leads to the employee whose contract it is', async () => {
    mount(BASE);
    const link = await screen.findByRole('link', { name: 'Rina Wijaya' });
    expect(link.getAttribute('href')).toBe('/hr/employees/detail?id=e-3');
  });

  it('says nothing at all when there is nothing to renew', async () => {
    mount({ ...BASE, documentsExpiring: [], employmentsEnding: [] });
    await waitFor(() => expect(screen.getByText('hrFix.home.headcountMix')).toBeTruthy());
    expect(screen.queryByText('hrFix.home.docsExpiring')).toBeNull();
    expect(screen.queryByText('hrFix.home.contractsEnding')).toBeNull();
  });
});
