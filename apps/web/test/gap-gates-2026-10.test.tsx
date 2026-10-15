// @vitest-environment jsdom
/*
 * 2026-10-15 gap pass — buttons drawn for a role whose server call answers 403, and doors
 * that opened onto a refusal. Each case asserts the request or the control that must NOT
 * exist for that role, so reverting a gate turns the matching test red.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, role } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  role: { current: 'SUPER_ADMIN' },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: role.current }, ready: true, signOut: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { ConfirmProvider } from '@/components/confirm';
import { LocaleProvider } from '@/lib/locale-context';
import HqRefundsPage from '@/app/hq/refunds/page';
import HqDepotsPage from '@/app/hq/depots/page';

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ConfirmProvider>{children}</ConfirmProvider>
  </LocaleProvider>
);

const refund = {
  id: 'pay-1',
  orderId: '11111111-1111-4111-8111-111111111111',
  orderNumber: 'HM-261015-001',
  customerId: 'c-1',
  method: 'TRANSFER',
  status: 'PAID',
  amount: 150_000,
  refundReason: 'galon bocor',
  refundApproval: 'PENDING',
  orderStatus: 'DELIVERED',
  createdAt: '2026-10-15T03:00:00.000Z',
  updatedAt: '2026-10-15T03:00:00.000Z',
};

beforeEach(() => {
  role.current = 'SUPER_ADMIN';
  const answer = (url: string) => {
    const u = String(url);
    if (u.includes('refunds/queue'))
      return Promise.resolve({ items: [refund], total: 1, page: 1, limit: 100 });
    if (u.includes('/depots')) return Promise.resolve({ items: [], total: 0, page: 1, limit: 100 });
    return Promise.resolve({ hqApprovalThresholdIdr: 100_000 });
  };
  get.mockReset().mockImplementation(answer);
  getCached.mockReset().mockImplementation(answer);
});
afterEach(() => vi.clearAllMocks());

describe('refund queue: watching is not deciding', () => {
  it('draws Setujui for FINANCE, who holds refundQueue', async () => {
    role.current = 'FINANCE';
    render(<HqRefundsPage />, { wrapper: Wrap });
    expect(await screen.findByText(/HM-261015-001/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /setujui/i })).toBeTruthy();
  });

  it.each(['HEAD_OFFICE', 'DIREKTUR'])(
    'draws no decision button for %s, who may only read the queue',
    async (r) => {
      role.current = r;
      render(<HqRefundsPage />, { wrapper: Wrap });
      expect(await screen.findByText(/HM-261015-001/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /setujui/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Tolak$/ })).toBeNull();
    },
  );
});

describe('opening a depot is head office, not the depot manager (depotLifecycle)', () => {
  it.each(['HEAD_OFFICE', 'DIREKTUR', 'SUPER_ADMIN'])('offers onboarding to %s', async (r) => {
    role.current = r;
    render(<HqDepotsPage />, { wrapper: Wrap });
    await waitFor(() => expect(screen.getByRole('button', { name: /depot baru|onboard|＋/i })).toBeTruthy());
  });

  it('offers no onboarding to FINANCE, who can read the page but not create a depot', async () => {
    role.current = 'FINANCE';
    render(<HqDepotsPage />, { wrapper: Wrap });
    await waitFor(() => expect(get.mock.calls.length + getCached.mock.calls.length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /depot baru|onboard|＋/i })).toBeNull();
  });
});
