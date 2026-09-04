// @vitest-environment jsdom
/*
 * CA-2-34, the owner's rule (2026-09-04): a cancelled order that was paid gets its money
 * back, full stop.
 *
 * Refusal used to be offered on every queued row. On a CANCELLED order that left the
 * customer's money with the business — the payment stayed PAID, the order was over, and
 * nothing was ever said to them. Refusal is for disputes on orders that are still standing.
 *
 * The screen half of that rule is this file: do not draw a button whose only possible
 * outcome is a 422, say why instead — and when refusal IS allowed, make it carry a reason
 * in the rejector's own words.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const row = (orderStatus: string | null) => ({
  id: 'pay-1',
  orderId: '11111111-1111-4111-8111-111111111111',
  orderNumber: 'HM-260904-001',
  customerId: 'c-1',
  method: 'TRANSFER',
  status: 'PAID',
  amount: 150_000,
  refundReason: 'galon bocor',
  refundApproval: 'PENDING',
  orderStatus,
  createdAt: '2026-09-04T03:00:00.000Z',
  updatedAt: '2026-09-04T03:00:00.000Z',
});

const serve = (orderStatus: string | null) => {
  const answer = (url: string) =>
    String(url).includes('refunds/queue')
      ? Promise.resolve({ items: [row(orderStatus)], total: 1, page: 1, limit: 100 })
      : Promise.resolve({ hqApprovalThresholdIdr: 100_000 });
  get.mockReset().mockImplementation(answer);
  getCached.mockReset().mockImplementation(answer);
};

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  toast.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('a cancelled order’s refund cannot be refused (CA-2-34)', () => {
  it('offers no Tolak, and says why', async () => {
    serve('CANCELLED');
    render(<HqRefundsPage />, { wrapper: Wrap });

    expect(await screen.findByText(/HM-260904-001/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Tolak$/ })).toBeNull();
    // Not a blank space where a button was: the reader is told the money is owed.
    expect(screen.getByText(/refund wajib dikembalikan/i)).toBeTruthy();
    // Approving is still on offer — that is the outcome the rule points at.
    expect(screen.getByRole('button', { name: /setujui/i })).toBeTruthy();
  });

  it('offers no Tolak when the order could not be read either', async () => {
    // `null` cannot be PROVEN not to be cancelled, and the server refuses on that basis.
    // Drawing the button would only produce a 422 the reader cannot act on.
    serve(null);
    render(<HqRefundsPage />, { wrapper: Wrap });

    expect(await screen.findByText(/HM-260904-001/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Tolak$/ })).toBeNull();
    expect(screen.getByText(/tidak terbaca/i)).toBeTruthy();
  });
});

describe('a refusal that IS allowed has to say why (CA-2-34)', () => {
  it('asks for a reason and sends it', async () => {
    serve('DELIVERED');
    render(<HqRefundsPage />, { wrapper: Wrap });

    await userEvent.click(await screen.findByRole('button', { name: /^Tolak$/ }));

    // The screen used to POST `{}`, so the server fell back to the REQUESTER's reason and
    // the audit read as though the person refusing had written it.
    const box = await screen.findByRole('textbox');
    await userEvent.type(box, 'sudah diganti di tempat');
    const confirms = screen.getAllByRole('button', { name: /^Tolak$/ });
    await userEvent.click(confirms[confirms.length - 1]!);

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(String(post.mock.calls[0]![0])).toContain('/reject');
    expect(post.mock.calls[0]![1]).toEqual({ reason: 'sudah diganti di tempat' });
  });

  it('sends nothing when the reason is abandoned', async () => {
    serve('DELIVERED');
    render(<HqRefundsPage />, { wrapper: Wrap });

    await userEvent.click(await screen.findByRole('button', { name: /^Tolak$/ }));
    await userEvent.click(await screen.findByRole('button', { name: /batal/i }));

    expect(post).not.toHaveBeenCalled();
  });
});
