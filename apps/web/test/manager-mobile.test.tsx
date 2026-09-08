// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two manager-on-a-phone screens.
 *
 *  - CA-4-11: three "Buka di desktop" shortcuts, offered to everyone who could open the
 *    screen. Two of them land a MANAGER — the role this whole surface exists for — on a
 *    rejection page, because `franchise` is FRANCHISE_OWNER-only and `staffAdmin` is
 *    HEAD_OFFICE/SUPER_ADMIN-only.
 *  - CA-4-42: the server has accepted APPROVE | REJECT | HOLD since the first migration and
 *    the desktop screen offers all three. This one offered two, so "I need to ask somebody"
 *    was not a thing a manager holding a phone could say — while the list already treated
 *    HELD as still-pending, making the state reachable and unreachable at once.
 */

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, patch, post: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id', setLocale: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/m/manager',
  useSearchParams: () => new URLSearchParams('id=a-1'),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => 'a-1' }));
vi.mock('@/components/confirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ selected: { id: 'd1', name: 'Depot Satu' }, depots: [], ready: true }),
}));

const role = { current: 'MANAGER' };
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u1', fullName: 'Rina', role: role.current, assignedDepotId: 'd1' },
    ready: true,
    signOut: vi.fn(),
  }),
}));

import ManagerAccountPage from '@/app/m/manager/account/page';
import ApprovalDetailPage from '@/app/m/manager/approvals/detail/page';

const APPROVAL = {
  id: 'a-1',
  type: 'COD_VARIANCE',
  title: 'Selisih setoran',
  status: 'PENDING',
  amountIdr: 50_000,
  submittedBy: 'u-9',
  createdAt: '2026-09-01T02:00:00.000Z',
  payload: {},
  subjectRef: null,
  decidedBy: null,
  decidedAt: null,
};

beforeEach(() => {
  role.current = 'MANAGER';
  get.mockReset().mockImplementation(async (u: string) =>
    String(u).includes('customers') ? [{ id: 'u-9', fullName: 'Budi', phone: '0811' }] : APPROVAL,
  );
  patch.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe('CA-4-11 the desktop shortcuts a manager can actually open', () => {
  it('hides the two that would land on a rejection page', () => {
    render(<ManagerAccountPage />);
    // `inventoryRead` includes MANAGER — the one that always worked.
    expect(screen.getByText('hrFix.mgrAccount.purchaseOrders')).toBeTruthy();
    // `franchise` is FRANCHISE_OWNER-only; `staffAdmin` is HEAD_OFFICE/SUPER_ADMIN-only.
    expect(screen.queryByText('hrFix.mgrAccount.pnl')).toBeNull();
    expect(screen.queryByText('hrFix.mgrAccount.manageTeam')).toBeNull();
  });

  it('still offers all three to a role that holds all three capabilities', () => {
    role.current = 'SUPER_ADMIN';
    render(<ManagerAccountPage />);
    expect(screen.getByText('hrFix.mgrAccount.purchaseOrders')).toBeTruthy();
    expect(screen.getByText('hrFix.mgrAccount.manageTeam')).toBeTruthy();
  });
});

describe('CA-4-42 the third decision, and the context to make it', () => {
  it('sends HOLD when Tahan is pressed — the label is not the assertion', async () => {
    render(<ApprovalDetailPage />);
    await waitFor(() => expect(screen.getByText('dashA.approvalDetail.hold')).toBeTruthy());
    expect(screen.getByText('hrFix.approvalDetail.reject')).toBeTruthy();
    expect(screen.getByText('hrFix.approvalDetail.approve')).toBeTruthy();

    await userEvent.click(screen.getByText('dashA.approvalDetail.hold'));

    // A button labelled "Tahan" that sends APPROVE is worse than no button, and asserting
    // only the label cannot tell the two apart — this assertion stayed green through a
    // deliberate revert until it was written this way.
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ decision: 'HOLD' });
  });

  it('does not demand a reason for a hold — it refuses nothing and moves no money', async () => {
    render(<ApprovalDetailPage />);
    await waitFor(() => expect(screen.getByText('dashA.approvalDetail.hold')).toBeTruthy());
    await userEvent.click(screen.getByText('dashA.approvalDetail.hold'));
    // A rejection must say why. A hold is "ask somebody", not a refusal.
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(screen.queryByText('mgrFix.approvalDecide.rejectReasonRequired')).toBeNull();
  });

  it('names who asked and when, not just how much', async () => {
    render(<ApprovalDetailPage />);
    // CA-2-66 put both on the desktop screen; this one had neither.
    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy());
    expect(screen.getByText('hrFix.approvalDetailExtra.submittedAt')).toBeTruthy();
  });
});
