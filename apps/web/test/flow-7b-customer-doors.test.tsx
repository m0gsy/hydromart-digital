// @vitest-environment jsdom
/**
 * Flow plan PR-7b · four doors the customer app was missing.
 *
 * - "Pesan lagi" lived only on an order's detail; the order list makes it one tap.
 * - "Laporkan masalah": the order detail had no way to the complaint form, and the form read
 *   no parameter, so the customer retyped the order number from memory.
 * - "Jadikan langganan": a product page had no way to the subscription form, and the form
 *   read no parameter either.
 * - Checkout forgot the payment method: every order started at cash.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, push, query, flags } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
  query: { params: {} as Record<string, string> },
  flags: { list: [] as { key: string; enabled: boolean }[] },
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn() }) }));
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({ location: { lat: -6.2, lng: 106.8, depotId: 'd-1' }, ready: true }),
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: (k: string) => query.params[k] ?? null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import OrdersPage from '@/app/orders/page';
import { Complaints } from '@/app/help/complaints';
import SubscriptionsPage from '@/app/subscriptions/page';
import ProductDetailPage from '@/app/products/detail/page';
import { rememberMethod, rememberedMethod } from '@/lib/payments';

const order = (id: string, status: string, productIds: string[]) => ({
  id,
  orderNumber: `HM-${id}`,
  status,
  createdAt: '2026-11-18T03:00:00Z',
  total: 40_000,
  items: productIds.map((productId) => ({ productId, productName: 'Galon', quantity: 2, unitPrice: 20_000 })),
});

beforeEach(() => {
  query.params = {};
  flags.list = [];
  push.mockReset();
  post.mockReset();
  get.mockReset().mockImplementation(async (path: string) => {
    if (path.includes('flags')) return flags.list;
    return [];
  });
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

const draw = (ui: React.ReactElement) => render(ui, { wrapper: LocaleProvider });

describe('"Pesan lagi" on the order list', () => {
  const serve = () =>
    get.mockImplementation(async (path: string) => {
      if (path.includes('/orders/api/v1/orders')) {
        return { items: [order('o-1', 'DELIVERED', ['p-1']), order('o-2', 'CONFIRMED', ['p-1'])], total: 2, page: 1, limit: 20 };
      }
      return [];
    });

  it('a finished order carries it; one still on its way does not', async () => {
    serve();
    draw(<OrdersPage />);
    await screen.findByText('HM-o-1');
    expect(screen.getAllByRole('button', { name: /Pesan lagi/ })).toHaveLength(1);
  });

  it('puts the lines back and opens the cart', async () => {
    serve();
    post.mockResolvedValue({ items: [{ productId: 'p-1' }] });
    draw(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Pesan lagi/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/cart'));
    expect(post).toHaveBeenCalledWith(expect.stringContaining('o-1'), {}, true);
  });

  it('says so on the row when nothing could be added', async () => {
    serve();
    post.mockResolvedValue({ items: [] });
    draw(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Pesan lagi/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/tidak ada|tidak bisa|tidak tersedia/i);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('"Laporkan masalah" opens the complaint about THAT order', () => {
  it('?order= opens the form with the order number filled in', async () => {
    query.params = { order: 'HM-260816-001' };
    draw(<Complaints />);
    const ref = (await screen.findByLabelText(/nomor pesanan|order number/i)) as HTMLInputElement;
    expect(ref.value).toBe('HM-260816-001');
  });

  it('a link is not a keyboard: the number is held to the field\u2019s 64 characters', async () => {
    query.params = { order: `  ${'X'.repeat(200)}  ` };
    draw(<Complaints />);
    const ref = (await screen.findByLabelText(/nomor pesanan|order number/i)) as HTMLInputElement;
    expect(ref.value).toBe('X'.repeat(64));
  });

  it('without it, the form stays shut as before', async () => {
    draw(<Complaints />);
    await screen.findByRole('button', { name: /ajukan komplain|raise a complaint/i });
    expect(screen.queryByLabelText(/nomor pesanan|order number/i)).toBeNull();
  });
});

describe('"Jadikan langganan" opens the subscription form on that product', () => {
  const serve = () =>
    get.mockImplementation(async (path: string) => {
      if (path.includes('flags')) return flags.list;
      if (path.includes('/products/api/v1/products?') || path.includes('/products/api/v1/products/browse')) {
        return { items: [{ id: 'p-1', name: 'Galon 19L', unit: 'Galon' }, { id: 'p-2', name: 'Galon 12L', unit: 'Galon' }], total: 2 };
      }
      if (path.includes('/subscriptions/discount') || path.includes('discount')) return { rate: 0 };
      return [];
    });

  it('?product= picks it', async () => {
    serve();
    query.params = { product: 'p-2' };
    draw(<SubscriptionsPage />);
    await waitFor(() => expect((document.getElementById('sub-product') as HTMLSelectElement | null)?.value).toBe('p-2'));
  });

  it('a product page links there, while subscriptions are on', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.includes('flags')) return flags.list;
      if (path.includes('/products/api/v1/products/p-1')) {
        return { id: 'p-1', name: 'Galon 19L', sku: 'AIR-19L', unit: 'Galon', basePrice: 20_000, imageUrl: null, isActive: true, isGallon: true };
      }
      if (path.includes('shelf-prices')) return { basis: 'CATALOG', prices: [] };
      return [];
    });
    query.params = { id: 'p-1' };
    draw(<ProductDetailPage />);
    const link = await screen.findByRole('link', { name: /Jadikan langganan/ });
    expect(link.getAttribute('href')).toBe('/subscriptions?product=p-1');
  });

  it('and not while they are off', async () => {
    flags.list = [{ key: 'subscriptions.galon', enabled: false }];
    get.mockImplementation(async (path: string) => {
      if (path.includes('flags')) return flags.list;
      if (path.includes('/products/api/v1/products/p-1')) {
        return { id: 'p-1', name: 'Galon 19L', sku: 'AIR-19L', unit: 'Galon', basePrice: 20_000, imageUrl: null, isActive: true, isGallon: true };
      }
      if (path.includes('shelf-prices')) return { basis: 'CATALOG', prices: [] };
      return [];
    });
    query.params = { id: 'p-1' };
    draw(<ProductDetailPage />);
    await screen.findAllByText('Galon 19L');
    expect(screen.queryByRole('link', { name: /Jadikan langganan/ })).toBeNull();
  });
});

describe('checkout remembers the payment method', () => {
  it('keeps the last method placed, per customer, and ignores anything else in the slot', () => {
    expect(rememberedMethod('c-1')).toBeNull();
    rememberMethod('c-1', 'QRIS');
    expect(rememberedMethod('c-1')).toBe('QRIS');
    // A shared phone: the next account signed in does not inherit it.
    expect(rememberedMethod('c-2')).toBeNull();
    localStorage.setItem('hm.checkout.lastMethod.c-1', 'BITCOIN');
    expect(rememberedMethod('c-1')).toBeNull();
  });
});
