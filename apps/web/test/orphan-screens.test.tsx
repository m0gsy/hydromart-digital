// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, getCached, post } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached, post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu', phone: '0811' }, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { screenChrome } from '@/lib/screen-chrome';
import { PromoCarousel } from '@/components/promo-carousel';
import AccountPage from '@/app/account/page';

const PROMO = (id: string) => ({
  id,
  title: `Promo ${id}`,
  description: 'Hemat',
  discountType: 'PERCENTAGE',
  discountValue: 10,
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
  active: true,
});

beforeEach(() => {
  get.mockReset().mockResolvedValue([]);
  getCached.mockReset().mockResolvedValue([]);
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

/**
 * H2. `/promo` is 252 lines with its own hero, voucher wallet and product grid, and its
 * ONE way in was gated on `data.length > 2` — so a depot running one or two promotions
 * had a screen nobody could reach. Production ran ZERO promotions on 22 Aug 2026, which
 * is the same door bolted twice.
 *
 * The gate's stated reason ("the carousel already shows every promo") does not survive
 * reading the page: `/promo` also lists vouchers and promo products the carousel never
 * draws, so it is never redundant.
 */
describe('H2 — /promo has a way in', () => {
  it('links out when the home carousel shows a single promo', async () => {
    getCached.mockResolvedValue([PROMO('p1')]);
    render(<PromoCarousel />, { wrapper: LocaleProvider });

    await screen.findByText('Promo p1');
    const link = await screen.findByRole('link', { name: /lihat semua/i });
    expect(link).toHaveAttribute('href', '/promo');
  });

  it('links out when it shows two', async () => {
    getCached.mockResolvedValue([PROMO('p1'), PROMO('p2')]);
    render(<PromoCarousel />, { wrapper: LocaleProvider });

    const link = await screen.findByRole('link', { name: /lihat semua/i });
    expect(link).toHaveAttribute('href', '/promo');
  });
});

/**
 * H3. `/waralaba` is a real franchise application form, and its only inbound link lived in
 * the desktop footer — which is `hidden ... sm:block`. On a phone, and therefore inside
 * both APKs, the form did not exist. The privacy policy and the deletion page already
 * moved into /account for exactly this reason; this one was missed.
 */
describe('H3 — /waralaba is reachable on a phone', () => {
  it('is offered from /account, which the phone can reach', async () => {
    render(<AccountPage />, { wrapper: LocaleProvider });

    const links = await screen.findAllByRole('link', { name: /waralaba|franchise/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/waralaba');
  });
});

/**
 * H4. Both are the pages a Play reviewer opens, and both were `bare` chrome — no app bar,
 * no back chevron, no tab bar. On a phone that is a dead end: the only way out is the OS
 * back gesture, and a deep link straight into one has nothing behind it at all.
 *
 * `bare` is right for /login, /register and /verify — those screens own the whole viewport
 * on purpose. A legal page is a pushed screen and always was.
 */
describe('H4 — the legal pages are not dead ends', () => {
  it.each(['/hapus-akun', '/kebijakan-privasi'])('%s carries an app bar with a title', (path) => {
    const chrome = screenChrome(path);
    expect(chrome.kind).toBe('pushed');
    expect(chrome.titleKey).toBeTruthy();
  });

  it('still leaves the auth screens bare', () => {
    for (const path of ['/login', '/register', '/verify']) {
      expect(screenChrome(path).kind).toBe('bare');
    }
  });
});
