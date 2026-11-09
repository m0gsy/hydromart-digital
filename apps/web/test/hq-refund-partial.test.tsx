// @vitest-environment jsdom
/*
 * DEP-26. A refund can now return PART of a payment (a dispute only partly justified). The queue
 * used to show the payment total on every row, so an approver would read "Rp 150.000" for a
 * request that asks for Rp 20.000. It shows what is being asked for, and the total beside it.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u-1', role: 'SUPER_ADMIN' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/hq/refunds',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ConfirmProvider } from '@/components/confirm';
import HqRefundsPage from '@/app/hq/refunds/page';

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ConfirmProvider>{children}</ConfirmProvider>
  </LocaleProvider>
);

const row = (refundedAmount: number | null) => ({
  id: 'pay-1',
  orderId: '11111111-1111-4111-8111-111111111111',
  orderNumber: 'HM-260904-001',
  customerId: 'c-1',
  method: 'TRANSFER',
  status: 'PAID',
  amount: 150_000,
  refundedAmount,
  refundReason: 'dipungut lebih',
  refundApproval: 'PENDING',
  orderStatus: 'DELIVERED',
  createdAt: '2026-09-04T03:00:00.000Z',
  updatedAt: '2026-09-04T03:00:00.000Z',
});

const serve = (refundedAmount: number | null) => {
  const answer = (url: string) =>
    String(url).includes('refunds/queue')
      ? Promise.resolve({ items: [row(refundedAmount)], total: 1, page: 1, limit: 100 })
      : Promise.resolve({ hqApprovalThresholdIdr: 100_000 });
  get.mockReset().mockImplementation(answer);
  getCached.mockReset().mockImplementation(answer);
};

beforeEach(() => toast.mockReset());
afterEach(() => vi.clearAllMocks());

describe('the refund queue shows what is being asked for (DEP-26)', () => {
  it('shows the requested part, and the payment total beside it', async () => {
    serve(20_000);
    render(<HqRefundsPage />, { wrapper: Wrap });
    expect(await screen.findByText(/HM-260904-001/)).toBeTruthy();
    expect(screen.getByText(/20\.000/)).toBeTruthy();
    expect(screen.getByText(/dari.*150\.000/i)).toBeTruthy();
  });

  it('a whole-payment request shows only the total, as before', async () => {
    serve(150_000);
    render(<HqRefundsPage />, { wrapper: Wrap });
    expect(await screen.findByText(/HM-260904-001/)).toBeTruthy();
    expect(screen.getAllByText(/150\.000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/dari.*150\.000/i)).toBeNull();
  });

  it('an older row with no recorded amount shows the total', async () => {
    serve(null);
    render(<HqRefundsPage />, { wrapper: Wrap });
    expect(await screen.findByText(/HM-260904-001/)).toBeTruthy();
    expect(screen.queryByText(/dari.*150\.000/i)).toBeNull();
  });
});
