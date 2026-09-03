// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, patch, del, FakeApiError } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  FakeApiError: class FakeApiError extends Error {
    status: number;
    code: string;
    constructor(message: string, status = 400, code = 'BAD_REQUEST') {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, patch, del },
  ApiError: FakeApiError,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/addresses',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import AddressesPage from '@/app/addresses/page';
import SubscriptionsPage from '@/app/subscriptions/page';

const ADDRESS = {
  id: 'a-1',
  label: 'Rumah',
  recipientName: 'Wahyu',
  phone: '081234567890',
  addressLine: 'Jl. Mawar 1',
  city: 'Jakarta',
  province: 'DKI',
  postalCode: '12345',
  latitude: -6.2,
  longitude: 106.8,
  isPrimary: false,
};

const SUB = {
  id: 's-1',
  productId: 'p-1',
  productName: 'Galon 19L',
  quantity: 2,
  frequency: 'WEEKLY',
  status: 'ACTIVE',
  nextDeliveryAt: '2026-09-01T03:00:00.000Z',
  deliveryAddress: { addressLine: 'Jl. Mawar 1', city: 'Jakarta' },
};

const wrap = (node: React.ReactNode) => (
  <LocaleProvider>
    <ToastProvider>{node}</ToastProvider>
  </LocaleProvider>
);

beforeEach(() => {
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/addresses')) return Promise.resolve([ADDRESS]);
    if (p.includes('/subscriptions')) return Promise.resolve([SUB]);
    if (p.includes('/products')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve([]);
  });
  getCached.mockReset().mockResolvedValue([]);
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  del.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

/**
 * H9 (canonical — absorbs D5). Two customer screens dropped the outcome of a row action on
 * the floor. `/addresses` caught the rejection into an empty block with a comment saying
 * the reload "reflects reality"; `/subscriptions` had `try/finally` with no `catch` at
 * all, so the rejection escaped as an unhandled promise and the row simply snapped back.
 *
 * Either way the customer taps "Jadikan utama" or "Jeda", watches the row not change, and
 * has no way to tell a refusal from a no-op. The depot-side screens were fixed first, with
 * a comment (`promotions/page.tsx`) explaining exactly this consequence — the customer-side
 * ones were missed, which is why this item is the canonical one and D5 folds into it.
 */
describe('H9 — a refused row action says so', () => {
  it('/addresses: a refused "set primary" surfaces the server reason', async () => {
    post.mockRejectedValue(
      new FakeApiError('Alamat di luar jangkauan depot.', 422, 'OUT_OF_RANGE'),
    );
    render(wrap(<AddressesPage />));

    const btn = await screen.findByRole('button', { name: /jadikan utama|set as primary/i });
    await userEvent.click(btn);

    expect(await screen.findByText(/di luar jangkauan depot/i)).toBeInTheDocument();
  });

  it('/addresses: a refused delete surfaces the server reason', async () => {
    del.mockRejectedValue(new FakeApiError('Alamat dipakai langganan aktif.', 409, 'CONFLICT'));
    render(wrap(<AddressesPage />));

    await userEvent.click(await screen.findByRole('button', { name: /hapus|delete/i }));
    const confirm = await screen.findAllByRole('button', { name: /hapus|delete/i });
    await userEvent.click(confirm[confirm.length - 1]!);

    expect(await screen.findByText(/dipakai langganan aktif/i)).toBeInTheDocument();
  });

  it('/subscriptions: a refused pause surfaces the server reason instead of escaping', async () => {
    post.mockRejectedValue(new FakeApiError('Langganan sedang diproses.', 409, 'CONFLICT'));
    render(wrap(<SubscriptionsPage />));

    await userEvent.click(await screen.findByRole('button', { name: /jeda|pause/i }));

    expect(await screen.findByText(/sedang diproses/i)).toBeInTheDocument();
  });

  it('/subscriptions: a successful pause still reloads the list', async () => {
    render(wrap(<SubscriptionsPage />));

    await userEvent.click(await screen.findByRole('button', { name: /jeda|pause/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(String(post.mock.calls[0]?.[0])).toContain('/pause');
  });
});

/**
 * The rest of what these two screens draw. Both were imported by no test at all before
 * this, so v8 reported each as a single covered line — a page that manages where water is
 * delivered and one that manages standing orders, both reading "100%" at the gate.
 */
describe('/addresses — the states it draws', () => {
  it('offers a way to add one when the book is empty', async () => {
    get.mockImplementation(() => Promise.resolve([]));
    render(wrap(<AddressesPage />));

    expect(
      await screen.findByRole('button', { name: /tambah alamat|add address/i }),
    ).toBeInTheDocument();
  });

  it('offers a retry when the book will not load', async () => {
    get.mockRejectedValue(new FakeApiError('alamat 503'));
    render(wrap(<AddressesPage />));

    expect(await screen.findByRole('button', { name: /coba lagi|try again/i })).toBeInTheDocument();
  });

  it('marks which address is the primary one', async () => {
    get.mockImplementation((path: string) =>
      String(path).includes('/addresses')
        ? Promise.resolve([{ ...ADDRESS, isPrimary: true }])
        : Promise.resolve([]),
    );
    render(wrap(<AddressesPage />));

    await screen.findByText(/Jl. Mawar 1/);
    // A primary address offers no "make primary" button — it already is one.
    expect(screen.queryByRole('button', { name: /jadikan utama|set as primary/i })).toBeNull();
  });

  it('opens the sheet titled for a NEW address, not for an edit', async () => {
    render(wrap(<AddressesPage />));

    await userEvent.click(
      await screen.findByRole('button', { name: /tambah alamat|add address/i }),
    );
    // The sheet reuses one component for both jobs and picks its title from `editing`.
    expect(await screen.findByText(/alamat baru|new address/i)).toBeInTheDocument();
  });
});

describe('/subscriptions — the states it draws', () => {
  it('says the list is empty rather than drawing an empty box', async () => {
    get.mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/subscriptions')) return Promise.resolve([]);
      if (p.includes('/products')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve([]);
    });
    render(wrap(<SubscriptionsPage />));

    expect(await screen.findByText(/belum ada langganan|no subscription/i)).toBeInTheDocument();
  });

  it('offers resume, not pause, on a paused subscription', async () => {
    get.mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/subscriptions')) return Promise.resolve([{ ...SUB, status: 'PAUSED' }]);
      if (p.includes('/products')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve([]);
    });
    render(wrap(<SubscriptionsPage />));

    expect(await screen.findByRole('button', { name: /lanjutkan|resume/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^jeda$|^pause$/i })).toBeNull();
  });

  it('offers neither once the subscription is cancelled', async () => {
    get.mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/subscriptions')) return Promise.resolve([{ ...SUB, status: 'CANCELLED' }]);
      if (p.includes('/products')) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve([]);
    });
    render(wrap(<SubscriptionsPage />));

    await screen.findByText('Galon 19L');
    expect(screen.queryByRole('button', { name: /^jeda$|^pause$|lanjutkan|resume/i })).toBeNull();
  });
});
