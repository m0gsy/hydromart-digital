// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CA-2-66, the console half: three screens that had the answer and did not show it.
 *
 *  - The courier settlement queue labelled its rows with eight characters of a UUID, on
 *    the same screen where the franchise queue above it shows a name — and both ask the
 *    operator for the same decision: mark this payout PAID, or FAILED and credit it back.
 *  - The approval detail showed the amount, the threshold and the note, and never named
 *    who asked or who decided. Both have been on the record since the first migration.
 *  - The depot scorecard scored an unreadable SLA as 0% on-time. E-3 fixed exactly that
 *    mistake for revenue and left it standing on the other half.
 */
const { get, getCached } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get, getCached }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/locale-context', () => ({ useT: () => ({ t: (k: string) => k, locale: 'id' }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard/approvals/detail',
  useSearchParams: () => new URLSearchParams('id=a1'),
}));

import ApprovalDetailPage from '@/app/dashboard/approvals/detail/page';
import HqScorecardPage from '@/app/hq/scorecard/page';

beforeEach(() => {
  get.mockReset();
  getCached.mockReset();
  get.mockResolvedValue(null);
  getCached.mockResolvedValue([]);
});

describe('approval detail (CA-2-66)', () => {
  const APPROVAL = {
    id: 'a1',
    depotId: 'd1',
    type: 'OPNAME_VARIANCE',
    title: 'Selisih opname Galon 19L',
    subjectRef: 'Galon 19L',
    amountIdr: -250_000,
    autoPassThreshold: 100_000,
    status: 'APPROVED',
    payload: { system: 100, physical: 90, variance: -10 },
    submittedBy: '11111111-1111-4111-8111-111111111111',
    decidedBy: '22222222-2222-4222-8222-222222222222',
    decidedAt: '2026-09-01T03:00:00.000Z',
    decisionNote: null,
    createdAt: '2026-09-01T02:00:00.000Z',
  };

  it('names who asked and who decided', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('/approvals') ? APPROVAL : null,
    );
    getCached.mockImplementation(async (url: string) =>
      String(url).includes('by-ids')
        ? [
            { id: APPROVAL.submittedBy, fullName: 'Rina Operator', phone: '0811' },
            { id: APPROVAL.decidedBy, fullName: 'Budi Manajer', phone: '0812' },
          ]
        : [],
    );

    render(<ApprovalDetailPage />);

    await waitFor(() => expect(screen.getByText('Rina Operator')).toBeTruthy());
    expect(screen.getByText('Budi Manajer')).toBeTruthy();
  });

  /*
   * A decision screen has to render whether or not the staff directory answers. An
   * unresolved id is still an answer; an empty row is not.
   */
  it('falls back to a short id rather than an empty row', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('/approvals') ? APPROVAL : null,
    );
    getCached.mockRejectedValue(new Error('auth-service down'));

    render(<ApprovalDetailPage />);

    await waitFor(() => expect(screen.getByText('11111111')).toBeTruthy());
  });
});

describe('depot scorecard (CA-2-66)', () => {
  const depot = (over: Record<string, unknown>) => ({
    depotId: 'd1',
    code: 'JKT-01',
    name: 'Depot Cikini',
    active: true,
    ownershipType: 'HKP',
    revenue: 1_000_000,
    orderCount: 40,
    slaRate: 0.9,
    avgMinutes: 30,
    rating: 4.5,
    lowStockCount: 0,
    ...over,
  });

  it('shows an unreadable SLA as unknown, not as 0%', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('settings')
        ? { defs: [], effective: { scorecardRevenueWeightPct: 70 } }
        : { depots: [depot({ slaRate: null })] },
    );

    render(<HqScorecardPage />);

    await waitFor(() => expect(screen.getByText(/SLA/)).toBeTruthy());
    expect(screen.queryByText(/SLA 0%/)).toBeNull();
  });

  /*
   * And it must not rank the depot last for it. Weighting an unknown as the worst possible
   * number is the mistake E-3 named for revenue; the half that IS known is rescaled to the
   * full 100 instead.
   */
  it('does not rank a depot below a genuinely worse one for a missing SLA', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('settings')
        ? { defs: [], effective: { scorecardRevenueWeightPct: 70 } }
        : {
            depots: [
              depot({ depotId: 'bad', name: 'Depot Buruk', revenue: 100_000, slaRate: 0.1 }),
              depot({
                depotId: 'unknown',
                name: 'Depot Tanpa SLA',
                revenue: 1_000_000,
                slaRate: null,
              }),
            ],
          },
    );

    const { container } = render(<HqScorecardPage />);

    await waitFor(() => expect(screen.getByText('Depot Tanpa SLA')).toBeTruthy());
    const order = Array.from(container.querySelectorAll('*'))
      .map((el) => el.textContent ?? '')
      .filter((txt) => txt === 'Depot Tanpa SLA' || txt === 'Depot Buruk');
    expect(order[0]).toBe('Depot Tanpa SLA');
  });
});
