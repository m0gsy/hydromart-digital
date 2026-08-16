// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch, uploadFile } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch },
  uploadFile,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'm-1', role: 'MANAGER' } }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({
    scopedId: 'depot-a',
    selectedId: 'depot-a',
    selected: { id: 'depot-a', name: 'Depot A', code: 'DPT-A' },
    depots: [{ id: 'depot-a', name: 'Depot A', code: 'DPT-A' }],
    ready: true,
    error: null,
    reload: vi.fn(),
    setSelected: vi.fn(),
  }),
}));

import { LocaleProvider } from '@/lib/locale-context';
import PaymentReconPage from '@/app/dashboard/payment-recon/page';
import PaymentsPage from '@/app/dashboard/payments/page';

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

const order = (id: string, number: string, name: string, total: number) => ({
  id,
  orderNumber: number,
  recipientName: name,
  total,
  customerId: 'c-1',
  depotId: 'depot-a',
  status: 'DELIVERED',
});

/*
 * The reconciliation table rendered four hand-written rows — "ORD-0142 · Budi" Rp 57.000
 * and three siblings — unconditionally, with no badge marking them, on a depot manager's
 * money screen, and printed "2 belum cocok" counted from them.
 */
describe('payment reconciliation', () => {
  it('lists the depot own orders and the payment recorded against each', async () => {
    get.mockResolvedValue({
      items: [
        order('o-1', 'HM-260816-001', 'Ibu Rina', 57000),
        order('o-2', 'HM-260816-002', 'Toko Jaya', 96000),
      ],
      total: 2,
      page: 1,
      limit: 20,
    });
    post.mockResolvedValue([
      { id: 'p-1', orderId: 'o-1', method: 'CASH', status: 'PAID', amount: 57000 },
    ]);

    render(
      <LocaleProvider>
        <PaymentReconPage />
      </LocaleProvider>,
    );

    await screen.findByText(/HM-260816-001 · Ibu Rina/);
    expect(screen.getByText(/HM-260816-002 · Toko Jaya/)).toBeTruthy();
    // Not one of the invented rows survives.
    expect(screen.queryByText(/Budi|Siti|TRF-8891/)).toBeNull();
    // o-2 has no payment row at all, so it is the one still owed — and the count in the
    // header is that number, not a number counted from a constant.
    expect(screen.getByText(/1 belum lunas/)).toBeTruthy();
    expect(screen.getByText(/Belum ada pembayaran/)).toBeTruthy();
    // The payment read is one request for the whole page of orders, not one per row.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/payments/api/v1/payments/for-orders',
      { orderIds: ['o-1', 'o-2'] },
      true,
    );
  });

  it('shows a retryable error rather than a table when the payment read fails', async () => {
    get.mockResolvedValue({
      items: [order('o-1', 'HM-260816-001', 'Ibu Rina', 57000)],
      total: 1,
      page: 1,
      limit: 20,
    });
    post.mockRejectedValue(new Error('503'));

    render(
      <LocaleProvider>
        <PaymentReconPage />
      </LocaleProvider>,
    );

    await screen.findByRole('button', { name: /Coba lagi|Retry/i });
    // Half an answer is what this screen was being fixed for: no order may be shown with
    // its payment status silently missing.
    expect(screen.queryByText(/HM-260816-001/)).toBeNull();
    expect(screen.queryByText(/belum lunas/)).toBeNull();
  });
});

/*
 * `/dashboard/payments` filled `depot` only from `detail.data`, and tested `!depot` BEFORE
 * `detail.error` — so a failed read left loading false, depot null, and the skeleton branch
 * true forever. The ErrorState underneath it could not be reached by any input.
 */
describe('depot payment settings', () => {
  it('offers a retry instead of an endless skeleton when the depot read fails', async () => {
    get.mockRejectedValue(new Error('503'));

    const { container } = render(
      <LocaleProvider>
        <PaymentsPage />
      </LocaleProvider>,
    );

    await screen.findByRole('button', { name: /Coba lagi|Retry/i });
    await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull());
  });
});
