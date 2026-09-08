// @vitest-environment jsdom
/*
 * Three customer screens that stated something the bill does not do.
 *
 *  - CA-3-09: the cart showed the MEMBER discount to an agen. `order.service.ts` prices a
 *    reseller either by percent or by the SOP's flat rupiah per galon INSTEAD of membership
 *    and voucher — the branches are exclusive — and the agen figure the server had already
 *    computed and sent was not drawn at all.
 *  - CA-3-42: the voucher wallet never said which state a voucher was in, and drew an
 *    UPCOMING one exactly like an AVAILABLE one, "Pakai" button and all.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post, put } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post, put },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c1', role: 'CUSTOMER' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 2 }),
}));
vi.mock('@/lib/location-context', () => ({
  useLocation: () => ({
    location: { label: 'Ciputat', lat: -6.3, lng: 106.7, depotId: 'depot-1' },
    ready: true,
  }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/cart',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { ToastProvider } from '@/components/toast';
import { ConfirmProvider } from '@/components/confirm';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocaleProvider>
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  </LocaleProvider>
);

/** subtotal 100.000; the agen is let off 15.000 by the rule that actually bills them. */
const CART_AS_RESELLER = {
  items: [
    {
      productId: 'p1',
      name: 'Galon 19L',
      unitPrice: 20_000,
      quantity: 5,
      lineTotal: 100_000,
      imageUrl: null,
    },
  ],
  subtotal: 100_000,
  depotId: 'depot-1',
  pricingBasis: 'DEPOT',
  reseller: { applies: true, discountPct: 15, flatGallonPriceIdr: 0, discount: 15_000 },
};

beforeEach(() => {
  const impl = async (path: string) => {
    const p = String(path);
    if (p.includes('/cart')) return CART_AS_RESELLER;
    // A member rate that must NOT be applied to an agen.
    if (p.includes('/loyalty/me')) {
      return { pointsBalance: 0, lifetimePoints: 0, tier: 'GOLD', discountRate: 0.05 };
    }
    if (p.includes('/vouchers/')) {
      return [
        {
          code: 'NANTI10',
          description: null,
          discountType: 'PERCENTAGE',
          value: 10,
          minSpend: 0,
          maxDiscount: null,
          validUntil: null,
          status: 'UPCOMING',
        },
      ];
    }
    if (p.includes('/depots')) return { items: [], total: 0 };
    return [];
  };
  get.mockReset().mockImplementation(impl);
  getCached.mockReset().mockImplementation(impl);
  post.mockReset().mockResolvedValue({});
  put.mockReset().mockResolvedValue(CART_AS_RESELLER);
});
afterEach(() => vi.clearAllMocks());

describe('what the screen says is what the bill does', () => {
  it('shows the agen an agen price, not a member discount (CA-3-09)', async () => {
    const { default: CartPage } = await import('@/app/cart/page');
    render(<CartPage />, { wrapper });

    // The agen figure the server sent, and the total it implies.
    await waitFor(() => expect(screen.getAllByText(/15\.000/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/85\.000/).length).toBeGreaterThan(0);
    // The agen's own line is named as such...
    expect(screen.getByText(/Harga agen/)).toBeTruthy();
    // ...and the member row — the rule that does NOT bill this customer — is not drawn.
    // Asserted on the LABEL: "15.000" and "85.000" both end in "5.000", so a numeric
    // negative here would pass for the wrong reason.
    expect(screen.queryByText(/Diskon member/i)).toBeNull();
    expect(screen.queryByText(/95\.000/)).toBeNull();
  });

  it('says an upcoming voucher is not usable yet, and offers no way to use it (CA-3-42)', async () => {
    const { default: VouchersPage } = await import('@/app/vouchers/page');
    render(<VouchersPage />, { wrapper });

    await waitFor(() => expect(screen.getByText('NANTI10')).toBeTruthy());
    expect(screen.getByText(/Belum berlaku/)).toBeTruthy();
    // "Pakai" is only for the one state that can be spent today.
    expect(screen.queryByText(/^Pakai$/)).toBeNull();
  });
});
