// @vitest-environment jsdom
/**
 * Owner decision 2026-11-19: "Jadikan langganan" works for every product, not only the first 50.
 *
 * The subscription form listed the first 50 products. A product page past them linked here and
 * the form opened on the placeholder, with the product missing from the dropdown; a customer
 * opening the form from the menu could not reach it at all. The form reads every page now.
 */
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, query } = vi.hoisted(() => ({ get: vi.fn(), query: { product: null as string | null } }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, get, getCached: get, post: vi.fn() } };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: (k: string) => (k === 'product' ? query.product : null) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/subscriptions',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import SubscriptionsPage from '@/app/subscriptions/page';

// 130 products, served 100 a page: the 120th lives on page 2.
const ALL = Array.from({ length: 130 }, (_, i) => ({ id: `p-${i}`, name: `Produk ${i}`, unit: 'Galon', active: true }));

beforeEach(() => {
  query.product = null;
  get.mockReset().mockImplementation(async (path: string) => {
    if (path.includes('flags')) return [];
    if (path.includes('/products/api/v1/products')) {
      const u = new URL(path, 'http://x');
      const page = Number(u.searchParams.get('page') ?? 1);
      const limit = Number(u.searchParams.get('limit') ?? 20);
      return { items: ALL.slice((page - 1) * limit, page * limit), total: ALL.length, page, limit };
    }
    if (path.includes('discount')) return { rate: 0 };
    return [];
  });
});

const select = () => document.getElementById('sub-product') as HTMLSelectElement | null;

describe('the subscription form offers every product', () => {
  it('lists one past the first page, and picks it from the link', async () => {
    query.product = 'p-120';
    render(<SubscriptionsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(select()?.value).toBe('p-120'));
    expect(select()!.options.length).toBe(ALL.length + 1); // + the placeholder
  });

  it('picks it once: cleared by the customer, it stays cleared', async () => {
    query.product = 'p-3';
    const { rerender } = render(<SubscriptionsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(select()?.value).toBe('p-3'));
    fireEvent.change(select()!, { target: { value: 'p-7' } });
    rerender(<SubscriptionsPage />);
    expect(select()!.value).toBe('p-7');
  });
});
