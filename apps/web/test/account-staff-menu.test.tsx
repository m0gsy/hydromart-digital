// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * K1.3 — a courier or an operator opening /account is handed the full customer shop menu:
 * rewards, vouchers, favourites, subscriptions, referral, the franchise application. None
 * of it belongs to a staff account, and every other surface already strips shop chrome for
 * staff. The one row they DO need — the console — sits at the bottom of that list.
 */

const { get, getCached, post } = vi.hoisted(() => ({ get: vi.fn(), getCached: vi.fn(), post: vi.fn() }));
const auth = { customer: null as { id: string; role: string; fullName: string; phone: string } | null, ready: true };

vi.mock('@/lib/api', () => ({ api: { get, getCached, post }, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.customer, ready: auth.ready, signOut: vi.fn() }),
}));
vi.mock('@/lib/cart-context', () => ({ useCart: () => ({ bump: vi.fn(), apply: vi.fn(), count: 0 }) }));
vi.mock('@/lib/location-context', () => ({ useLocation: () => ({ location: null }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/account',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import AccountPage from '@/app/account/page';

beforeEach(() => {
  auth.ready = true;
  get.mockReset().mockImplementation((path: string) => {
    const p = String(path);
    if (p.includes('/loyalty/me')) return Promise.resolve({ pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE' });
    if (p.includes('gallon-deposit')) return Promise.resolve([]);
    if (p.includes('/profile/notifications')) return Promise.resolve({});
    return Promise.resolve([]);
  });
  getCached.mockReset().mockResolvedValue([]);
  post.mockReset();
});
afterEach(() => vi.clearAllMocks());

const hrefs = () =>
  Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));

describe('/account menu by who is looking', () => {
  it('a customer keeps the whole shop menu', async () => {
    auth.customer = { id: 'c-1', role: 'CUSTOMER', fullName: 'Rina', phone: '0811' };
    render(<AccountPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(hrefs()).toContain('/rewards'));
    expect(hrefs()).toEqual(expect.arrayContaining(['/orders', '/vouchers', '/favorites', '/subscriptions', '/referral']));
  });

  it('a courier gets the console and none of the shopping rows', async () => {
    auth.customer = { id: 's-1', role: 'STAFF_DEPOT', fullName: 'Andi', phone: '0812' };
    render(<AccountPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(hrefs()).toContain('/notifications'));
    const links = hrefs();
    expect(links).toContain('/dashboard/orders');
    for (const shopOnly of ['/rewards', '/vouchers', '/favorites', '/subscriptions', '/referral', '/waralaba', '/orders']) {
      expect(links).not.toContain(shopOnly);
    }
    // Help stays: a staff member needs the depot's number as much as a customer does.
    expect(links).toContain('/help');
  });

  it('the loyalty read is not even made for a staff account', async () => {
    auth.customer = { id: 's-2', role: 'DRIVER', fullName: 'Budi', phone: '0813' };
    render(<AccountPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('Budi')).toBeTruthy());
    expect(get.mock.calls.some(([p]) => String(p).includes('/loyalty/me'))).toBe(false);
  });
});
