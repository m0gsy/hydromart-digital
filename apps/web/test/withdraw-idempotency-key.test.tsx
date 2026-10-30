// @vitest-environment jsdom
//
// A withdrawal debits the balance, so a double tap or a retry whose answer was lost must not
// debit twice. Both cash-out pages hold ONE Idempotency-Key per attempt: a retry after a failure
// carries the same key (the server returns the first withdrawal), and a withdrawal that landed
// clears it so the NEXT cash-out is a new one.
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/driver/driver-shell', () => ({
  DriverShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/payout-account', () => ({
  PayoutAccountCard: () => null,
  useVerifiedPayoutAccount: () => ({ verified: true, loading: false, reload: vi.fn() }),
}));

const keyOf = (call: number) => (post.mock.calls[call][3] as Record<string, string>)['Idempotency-Key'];

describe('franchise payout withdrawal key', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({
      availableBalance: 5_000_000,
      monthRevenue: 0,
      monthCommission: 0,
      nextPayoutDate: '2026-10-25',
      recentEntries: [],
      recentWithdrawals: [],
    });
  });

  it('a retry after a failed attempt carries the same Idempotency-Key', async () => {
    post.mockRejectedValueOnce(new Error('network'));
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
    expect(await screen.findByText('dashB.payout.withdrawError')).toBeTruthy();

    fireEvent.click(screen.getByText('dashB.payout.withdraw'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    expect(keyOf(0)).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyOf(1)).toBe(keyOf(0));
  });
});

describe('courier earnings withdrawal key', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({
      availableBalance: 500_000,
      monthEarnings: 0,
      recentEntries: [],
      recentWithdrawals: [],
    });
  });

  async function openAndWithdraw(amount: string) {
    fireEvent.click(await screen.findByText('Tarik saldo'));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: amount } });
    fireEvent.click(screen.getByText('Tarik'));
  }

  it('a retry after a failure reuses the key; the next cash-out after a success gets a new one', async () => {
    post.mockRejectedValueOnce(new Error('network'));
    post.mockResolvedValue({});

    const { default: EarningsPage } = await import('@/app/driver/earnings/page');
    render(<EarningsPage />);

    await openAndWithdraw('100000');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await screen.findByText('hrFix.earnings.withdrawFailed');

    fireEvent.click(screen.getByText('Tarik'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(keyOf(1)).toBe(keyOf(0));
    expect(post.mock.calls[1][1]).toEqual({ amount: 100000 });

    // The second attempt landed: a fresh cash-out must not replay the first one.
    await openAndWithdraw('200000');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(keyOf(2)).not.toBe(keyOf(0));
  });
});
