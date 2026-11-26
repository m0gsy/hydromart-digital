// @vitest-environment jsdom
//
// HD-23 (owner decision 2026-11-26, "Tagihan saja"): customers pay the depot's own account, so HQ
// collects its royalty only through the monthly bill. The ledger balance on /dashboard/payout is
// bookkeeping: no withdraw button, a sentence saying why, and the bills sent to the owner.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/locale-context', () => ({
  useT: () => ({ t: (k: string) => k, locale: 'id' }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'FRANCHISE_OWNER' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const summary = {
  availableBalance: 5_000_000,
  monthRevenue: 0,
  monthCommission: 0,
  nextPayoutDate: '2026-10-25',
  recentEntries: [],
  recentWithdrawals: [],
};
const bill = {
  id: 'b1',
  month: '2026-10',
  legalEntityName: 'PT Mitra Air',
  totalIdr: 150_000,
  bank: { bankName: 'BCA', bankAccountNumber: '123456', bankAccountHolder: 'PT Indowater' },
  lines: [{ id: 'l1', label: 'Royalti Depot Satu', amountIdr: 150_000 }],
};

describe('franchise payout page', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('offers no withdrawal, says payment goes by bill, and lists the bills sent', async () => {
    get.mockImplementation(async (path: string) => (path.endsWith('/partner-bills/mine') ? [bill] : summary));
    const { default: PayoutPage } = await import('@/app/dashboard/payout/page');
    render(<PayoutPage />);

    expect(await screen.findByText('dashB.payout.byBill')).toBeTruthy();
    expect(await screen.findByText('Royalti Depot Satu')).toBeTruthy();
    expect(screen.getByText(/dashB\.payout\.billBank/)).toBeTruthy();
    expect(screen.queryByText('dashB.payout.withdraw')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('says so plainly when no bill has been sent yet', async () => {
    get.mockImplementation(async (path: string) => (path.endsWith('/partner-bills/mine') ? [] : summary));
    const { default: PayoutPage } = await import('@/app/dashboard/payout/page');
    render(<PayoutPage />);
    expect(await screen.findByText('dashB.payout.billsEmpty')).toBeTruthy();
  });
});
