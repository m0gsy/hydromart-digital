// @vitest-environment jsdom
/**
 * Owner decision 2026-11-19: "Jadikan langganan" works for every product, not only the first 50.
 *
 * The subscription form lists the first 50 products. A product page past them linked here and
 * the form opened on the placeholder, with the product missing from the dropdown. That product
 * is now read on its own and offered as well. A link id that is not a product id asks nothing.
 */
import { render, waitFor } from '@testing-library/react';
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

const FAR = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const listed = [
  { id: 'p-1', name: 'Galon 19L', unit: 'Galon', active: true },
  { id: 'p-2', name: 'Galon 12L', unit: 'Galon', active: true },
];

beforeEach(() => {
  query.product = null;
  get.mockReset().mockImplementation(async (path: string) => {
    if (path.includes('flags')) return [];
    if (path.endsWith(`/products/api/v1/products/${FAR}`)) {
      return { id: FAR, name: 'Galon Mineral 15L', unit: 'Galon', active: true };
    }
    if (path.includes('/products/api/v1/products')) return { items: listed, total: 80 };
    if (path.includes('discount')) return { rate: 0 };
    return [];
  });
});

const select = () => document.getElementById('sub-product') as HTMLSelectElement | null;

describe('the subscription form and a product past the first page', () => {
  it('reads it on its own, offers it and picks it', async () => {
    query.product = FAR;
    render(<SubscriptionsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(select()?.value).toBe(FAR));
    expect([...select()!.options].map((o) => o.value)).toContain(FAR);
  });

  it('a link id that is not a product id asks nothing', async () => {
    query.product = '../orders/api/v1/orders';
    render(<SubscriptionsPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(select()).not.toBeNull());
    // No product read was built from it (the subscription routes themselves live under orders).
    expect(get.mock.calls.some((c) => String(c[0]).includes('../'))).toBe(false);
    expect(select()!.value).toBe('');
  });
});
