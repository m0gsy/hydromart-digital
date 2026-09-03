// @vitest-environment jsdom
/*
 * Five more places a customer screen said something that was not so.
 *
 * CA-3-30  a failed promo read read as "belum ada promo", and ordinary products wore a
 *          "Promo" badge over their ordinary price
 * CA-3-31  "jadikan utama" and "hapus" on a payment method failed without a sound
 * CA-3-32  a VOIDED counter sale sat on Home as a running order for ever
 * CA-3-33  a code left in the voucher box refused the whole order
 * CA-3-35  the "Lewati" link on /register followed a raw `next` from the URL
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, del, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, del, put: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/member', () => ({ useMemberRate: () => 0, memberPrice: (n: number) => n }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null, ready: true }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/promo',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import PromoPage from '@/app/promo/page';
import { ActiveOrderCard } from '@/components/active-order-card';

// `useCart` is mocked above, so the real provider is neither needed nor available.
const Wrap = LocaleProvider;

const PRODUCT = { id: 'p-1', name: 'Galon 19L', unit: 'Galon', basePrice: 20_000, imageUrl: null };

beforeEach(() => {
  toast.mockReset();
  post.mockReset().mockResolvedValue({});
  del.mockReset().mockResolvedValue({});
  const answer = () => Promise.resolve([]);
  get.mockReset().mockImplementation(answer);
  getCached.mockReset().mockImplementation(answer);
});
afterEach(() => vi.clearAllMocks());

describe('the promo page tells a failed read from an empty one (CA-3-30)', () => {
  it('offers a retry instead of "belum ada promo" when the feed is down', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('/promotions')
        ? Promise.reject(new Error('503'))
        : Promise.resolve({ items: [], total: 0, page: 1, limit: 20 }),
    );

    render(<PromoPage />, { wrapper: Wrap });

    // "Belum ada promo aktif" to somebody whose request failed sends them away for good.
    await waitFor(() => expect(screen.getByText(/Gagal memuat promo/i)).toBeTruthy());
    expect(screen.queryByText(/Belum ada promo aktif/)).toBeNull();
  });

  it('stops calling ordinary catalogue products "Promo"', async () => {
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/promotions')) return Promise.resolve([]);
      if (u.includes('/products')) {
        return Promise.resolve({ items: [PRODUCT], total: 1, page: 1, limit: 20 });
      }
      return Promise.resolve([]);
    });

    render(<PromoPage />, { wrapper: Wrap });

    // There is no promo-tagged product endpoint — the strip is the catalogue head, and the
    // comment beside the fetch has always said so.
    expect(await screen.findByText('Galon 19L')).toBeTruthy();
    expect(screen.getByText(/Produk terlaris/)).toBeTruthy();
    expect(screen.queryByText(/^Promo$/)).toBeNull();
  });
});

describe('a voided counter sale leaves the Home page (CA-3-32)', () => {
  const order = (status: string) => ({
    items: [
      {
        id: 'o-1',
        orderNumber: 'HM-0001',
        status,
        createdAt: '2026-08-10T03:00:00.000Z',
        items: [],
        total: 20_000,
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  });

  it('shows nothing for a VOIDED sale', async () => {
    get.mockImplementation(() => Promise.resolve(order('VOIDED')));

    const { container } = render(<ActiveOrderCard />, { wrapper: Wrap });

    // There is no later status to move it on, and nothing else ever clears it — so a sale
    // the cashier undid sat here as "pesanan berjalan" for ever.
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).not.toMatch(/HM-0001/));
  });

  it('still shows a live one', async () => {
    get.mockImplementation(() => Promise.resolve(order('PREPARING')));

    render(<ActiveOrderCard />, { wrapper: Wrap });

    expect(await screen.findByText(/HM-0001/)).toBeTruthy();
  });
});

describe('the register skip link cannot be aimed off-site (CA-3-35)', () => {
  it('keeps a same-app path and refuses another origin', async () => {
    const { resolveDeepLink } = await import('@/lib/deep-link');
    // The guard the verify screen already uses (E1). A same-app path survives...
    expect(resolveDeepLink('/checkout')).toBe('/checkout');
    // ...a protocol-relative URL is refused outright...
    expect(resolveDeepLink('//evil.example')).toBeNull();
    // ...and an absolute URL keeps only its PATH, which is the whole protection: whatever
    // comes back can only ever be somewhere inside this app.
    for (const hostile of ['https://evil.example/steal', 'http://evil.example/?x=1']) {
      const out = resolveDeepLink(hostile);
      expect(out === null || out.startsWith('/')).toBe(true);
      expect(String(out)).not.toContain('evil.example');
    }
  });
});

describe('a payment-method action that fails says so (CA-3-31)', () => {
  const method = (id: string, isDefault = false) => ({
    id,
    type: 'TRANSFER',
    label: 'BCA',
    maskedNumber: '••••4821',
    isDefault,
  });

  const drawSheet = async () => {
    const { default: AccountPage } = await import('@/app/account/page');
    render(<AccountPage />, { wrapper: Wrap });
    // The methods live behind a sheet on the account screen.
    await userEvent.click((await screen.findAllByText(/Metode pembayaran/))[0]!);
    await screen.findAllByText('BCA');
  };

  it('reports a failed "jadikan utama" instead of leaving the row where it was', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('payment-methods')
        ? Promise.resolve([method('pm-1'), method('pm-2', true)])
        : Promise.resolve([]),
    );
    getCached.mockImplementation(() => Promise.resolve([]));
    post.mockRejectedValue(new Error('503'));

    await drawSheet();
    await userEvent.click((await screen.findAllByRole('button', { name: /jadikan utama/i }))[0]!);

    // It awaited a POST with nothing around it: a rejected promise became an unhandled
    // rejection, the row did not move, and the card that gets charged stayed the old one.
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0]![1]).toBe('error');
  });
});
