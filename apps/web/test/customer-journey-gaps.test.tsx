// @vitest-environment jsdom
/*
 * Six customer-facing screens that lost, hid, or lied about something.
 *
 * CA-3-21  the first delivery date was computed in UTC, so "besok" meant today overnight
 * CA-3-24  a failed add-to-cart looked exactly like a tap that missed
 * CA-3-25  the home rail threw away a guest's chosen product and landed them elsewhere
 * CA-3-26  every favourite failing to load read as "belum ada favorit"
 * CA-3-27  the order list stopped at twenty with nothing saying there were more
 * CA-3-28  "Pesan lagi" said it worked even when nothing was added
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, push, toast } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null, ready: true }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const auth = { customer: null as { id: string } | null, ready: true };
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth }));

import { LocaleProvider } from '@/lib/locale-context';
import { CartProvider } from '@/lib/cart-context';
import FavoritesPage from '@/app/favorites/page';
import OrdersPage from '@/app/orders/page';
import { ProductCard } from '@/components/product-card';
import { ProductRecRail } from '@/components/product-rec-rail';
import { takePendingAdd } from '@/lib/pending-add';
import { dateInDaysWib } from '@/lib/wib';

const PRODUCT = { id: 'p-1', name: 'Galon 19L', unit: 'Galon', basePrice: 20_000, imageUrl: null };

/** `ProductCard` and the recommendation rails read the cart badge, so every screen here
 *  needs the provider — including the two that only render a card as a child. */
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <CartProvider>{children}</CartProvider>
  </LocaleProvider>
);

const order = (n: number) => ({
  id: `o-${n}`,
  orderNumber: `HM-${String(n).padStart(4, '0')}`,
  status: 'COMPLETED',
  createdAt: '2026-08-10T03:00:00.000Z',
  items: [{ productId: 'p-1', quantity: 1 }],
  total: 20_000,
});

beforeEach(() => {
  auth.customer = { id: 'c-1' };
  // Both readers answer SOMETHING by default: a `useAsync` fetcher that resolves to
  // undefined throws inside React, and the component that dies is rarely the one under test.
  // Both readers answer SOMETHING by default: a `useAsync` fetcher that resolves to
  // undefined throws inside React, and the component that dies is rarely the one under
  // test. The cart gets a cart-shaped answer because `CartProvider` reduces over its items.
  const fallback = (url: string) =>
    String(url).includes('/cart')
      ? Promise.resolve({
          items: [],
          subtotal: 0,
          depotId: null,
          pricingBasis: 'CATALOG',
          reseller: null,
        })
      : Promise.resolve([]);
  get.mockReset().mockImplementation(fallback);
  getCached.mockReset().mockImplementation(fallback);
  post.mockReset();
  push.mockReset();
  toast.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('favourites tells a failed load from an empty list (CA-3-26)', () => {
  it('offers a retry rather than "belum ada favorit" when the catalogue is down', async () => {
    getCached.mockImplementation((url: string) =>
      String(url).includes('/favorites')
        ? Promise.resolve({ productIds: ['p-1', 'p-2'] })
        : Promise.resolve([]),
    );
    get.mockRejectedValue(new Error('503 dari katalog'));

    render(<FavoritesPage />, { wrapper: Wrap });

    // The empty state would be a lie: this customer has two favourites.
    await waitFor(() => expect(screen.queryByText(/belum ada favorit/i)).toBeNull());
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeTruthy();
  });

  it('still skips one dead favourite without losing the rest', async () => {
    getCached.mockImplementation((url: string) =>
      String(url).includes('/favorites')
        ? Promise.resolve({ productIds: ['p-1', 'gone'] })
        : Promise.resolve([]),
    );
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('gone')) return Promise.reject(new Error('404'));
      if (u.includes('/products/')) return Promise.resolve(PRODUCT);
      if (u.includes('/cart'))
        return Promise.resolve({
          items: [],
          subtotal: 0,
          depotId: null,
          pricingBasis: 'CATALOG',
          reseller: null,
        });
      return Promise.resolve([]);
    });

    render(<FavoritesPage />, { wrapper: Wrap });

    expect(await screen.findByText('Galon 19L')).toBeTruthy();
  });
});

describe('the order list can reach past its first page (CA-3-27)', () => {
  it('offers more, and keeps what was already on screen', async () => {
    const page1 = {
      items: Array.from({ length: 20 }, (_, i) => order(i + 1)),
      total: 23,
      page: 1,
      limit: 20,
    };
    const page2 = { items: [order(21), order(22), order(23)], total: 23, page: 2, limit: 20 };
    // URL-aware: this screen also draws a "beli lagi" rail, and handing IT a page object
    // crashes the render long before the list is on screen.
    get.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/recommendations/')) return Promise.resolve([]);
      if (u.includes('page=2')) return Promise.resolve(page2);
      return Promise.resolve(page1);
    });

    render(<OrdersPage />, { wrapper: Wrap });

    expect(await screen.findByText('HM-0001')).toBeTruthy();
    expect(screen.queryByText('HM-0021')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /muat lebih banyak/i }));

    expect(await screen.findByText('HM-0021')).toBeTruthy();
    // Page 1 is still there: pressing the button must never take away what was being read.
    expect(screen.getByText('HM-0001')).toBeTruthy();
  });

  it('hides the button when the first page is the whole list', async () => {
    get.mockImplementation((url: string) =>
      String(url).includes('/recommendations/')
        ? Promise.resolve([])
        : Promise.resolve({ items: [order(1)], total: 1, page: 1, limit: 20 }),
    );

    render(<OrdersPage />, { wrapper: Wrap });

    expect(await screen.findByText('HM-0001')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /muat lebih banyak/i })).toBeNull();
  });
});

describe('a failed add-to-cart says so (CA-3-24)', () => {
  it('tells the customer instead of silently rolling the badge back', async () => {
    post.mockRejectedValue(new Error('stok habis'));

    render(<ProductCard product={PRODUCT as never} />, { wrapper: Wrap });

    await userEvent.click(screen.getByRole('button', { name: /tambah/i }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0]![1]).toBe('error');
  });
});

describe('the subscription start date is a business date (CA-3-21)', () => {
  it('says tomorrow, not today, at 01:00 WIB', () => {
    // 2026-08-10T01:00+07:00 is still 2026-08-09 in UTC — the hour the old code was wrong.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T01:00:00+07:00'));
    expect(dateInDaysWib(1)).toBe('2026-08-11');
    expect(dateInDaysWib(0)).toBe('2026-08-10');
    vi.useRealTimers();
  });
});

describe('the home rail keeps a guest’s choice (CA-3-25)', () => {
  it('remembers the product and comes back here, not to a product page', async () => {
    auth.customer = null;
    getCached.mockImplementation(() => Promise.resolve([{ productId: 'p-1', name: 'Galon 19L' }]));
    get.mockImplementation(() => Promise.resolve([{ productId: 'p-1', name: 'Galon 19L' }]));

    render(<ProductRecRail title="Beli lagi" endpoint="/recommendations/api/v1/x" />, {
      wrapper: Wrap,
    });

    await userEvent.click(await screen.findByRole('button', { name: /tambah/i }));

    // Back HERE — the path the guest was on — rather than the product's own page.
    expect(push).toHaveBeenCalledWith(expect.stringContaining('/login?next='));
    expect(push.mock.calls[0]![0]).not.toContain('products%2Fdetail');
    // ...and the tap is not thrown away: signing in adds what they chose.
    expect(takePendingAdd()).toMatchObject({ productId: 'p-1', quantity: 1 });
  });
});
