// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, idParam } = vi.hoisted(() => ({
  get: vi.fn(() => new Promise(() => undefined)),
  getCached: vi.fn(() => Promise.resolve(null)),
  idParam: { value: '' },
}));

vi.mock('@/lib/api', () => ({ api: { get, getCached, post: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1' }, ready: true }),
}));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/use-query-param', () => ({ useQueryParam: () => idParam.value }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/orders/detail',
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import OrderDetailPage from '@/app/orders/detail/page';

const renderPage = () =>
  render(
    <LocaleProvider>
      <ToastProvider>
        <OrderDetailPage />
      </ToastProvider>
    </LocaleProvider>,
  );

afterEach(() => {
  window.history.replaceState({}, '', '/');
  idParam.value = '';
  vi.clearAllMocks();
});

describe('/orders/detail without an id', () => {
  it('says the order is not there and links to the order list, instead of loading for good', async () => {
    window.history.replaceState({}, '', '/orders/detail');
    renderPage();

    expect(await screen.findByText('Pesanan tidak ditemukan.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pesanan' }).getAttribute('href')).toBe('/orders');
    // Nothing is asked for an order nobody named.
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps loading when the address has an id the first render did not see yet (a push)', async () => {
    window.history.replaceState({}, '', '/orders/detail?id=o-1');
    renderPage();

    await Promise.resolve();
    expect(screen.queryByText('Pesanan tidak ditemukan.')).toBeNull();
  });

  it('loads the order when the id is known', () => {
    idParam.value = 'o-1';
    window.history.replaceState({}, '', '/orders/detail?id=o-1');
    renderPage();

    expect(screen.queryByText('Pesanan tidak ditemukan.')).toBeNull();
    expect(get).toHaveBeenCalledWith(expect.stringContaining('o-1'), true);
  });
});
