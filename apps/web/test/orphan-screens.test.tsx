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
  useAuth: () => ({
    customer: { id: 'c-1', role: 'CUSTOMER', fullName: 'Wahyu', phone: '0811' },
    ready: true,
    signOut: vi.fn(),
  }),
}));
vi.mock('@/lib/cart-context', () => ({
  useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }),
}));
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
import { Footer } from '@/components/footer';

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
 * CA-3-51. The terms page shipped with exactly one link in the whole app, and it lived
 * inside `{acceptance.data?.mustAccept && (` — so it appeared for a reader already being
 * made to agree to a new version, and for nobody else. Everyone else had no route to it:
 * not from /account, not from the footer (hidden below `sm:` anyway), not from search.
 *
 * `check-route-parity.mjs` counted it reachable, because a conditional href is still an
 * href in a grep. That is why this asserts the link RENDERS, not that the string exists.
 */
describe('CA-3-51 — the terms page is reachable without being asked to agree', () => {
  it('is offered from /account beside the privacy policy', async () => {
    render(<AccountPage />, { wrapper: LocaleProvider });

    // `mustAccept` is false here — the default fixture returns [] for every read — so this
    // is the ordinary reader who could not get there before.
    const links = await screen.findAllByRole('link', { name: /syarat|terms/i });
    expect(links.some((l) => l.getAttribute('href') === '/syarat-ketentuan')).toBe(true);
  });

  it('is offered from the desktop footer, which was orphaned too', () => {
    render(<Footer />, { wrapper: LocaleProvider });
    const links = screen.getAllByRole('link', { name: /syarat|terms/i });
    expect(links.some((l) => l.getAttribute('href') === '/syarat-ketentuan')).toBe(true);
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
  // CA-3-51: three, not two. `/syarat-ketentuan` was missing from this list AND from the
  // hand-typed ROUTES in screen-chrome.test.ts, which is why a legal page could ship with no
  // chrome and no link to it and pass both gates that exist to catch exactly that.
  it.each(['/hapus-akun', '/kebijakan-privasi', '/syarat-ketentuan'])(
    '%s carries an app bar with a title',
    (path) => {
      const chrome = screenChrome(path);
      expect(chrome.kind).toBe('pushed');
      expect(chrome.titleKey).toBeTruthy();
    },
  );

  it('still leaves the auth screens bare', () => {
    for (const path of ['/login', '/register', '/verify']) {
      expect(screenChrome(path).kind).toBe('bare');
    }
  });
});
