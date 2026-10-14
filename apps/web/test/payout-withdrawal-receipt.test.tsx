// @vitest-environment jsdom
//
// "Pencairan diproses" never appeared. `onWithdrawn` reloads the summary, `useAsync` flips
// `loading` back to true, and the page swapped its whole body for a skeleton — unmounting
// BalanceCard and the `done` receipt it had just set. The receipt must survive the refetch.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('@/components/payout-account', () => ({
  PayoutAccountCard: () => null,
  useVerifiedPayoutAccount: () => ({ verified: true, reload: vi.fn() }),
}));

const summary = {
  availableBalance: 5_000_000,
  monthRevenue: 0,
  monthCommission: 0,
  nextPayoutDate: '2026-10-25',
  recentEntries: [],
  recentWithdrawals: [],
};

describe('franchise payout withdrawal receipt', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('keeps the receipt on screen while the summary refetches', async () => {
    get.mockResolvedValueOnce(summary);
    // The refetch after the withdrawal never settles inside the test: the receipt has to
    // stand on its own while the page is `loading` again.
    get.mockReturnValueOnce(new Promise(() => {}));
    post.mockResolvedValueOnce({
      id: 'w1',
      amount: 2_000_000,
      bankAccountRef: 'BCA 1234',
      reference: 'WD-1',
      status: 'PROCESSING',
      createdAt: '2026-10-14T00:00:00.000Z',
    });

    const { default: PayoutPage } = await import('@/app/dashboard/payout/page');
    render(<PayoutPage />);

    fireEvent.click(await screen.findByText('2.000.000', { exact: false }));
    fireEvent.click(screen.getByText('dashB.payout.withdraw'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(await screen.findByText('dashB.payout.withdrawalProcessed')).toBeTruthy();
    // The receipt renders for one frame before the reload's `loading` flip lands, so asserting
    // once proves nothing: wait for the refetch to be in flight, then look again.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('dashB.payout.withdrawalProcessed')).not.toBeNull();
  });
});
