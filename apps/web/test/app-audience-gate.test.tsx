// @vitest-environment jsdom
/**
 * Owner decisions 2026-11-20: staff use the Ops app, customers the customer app. Staff whose HR
 * record carried a wrong number signed in to Ops on their real one, were signed up as customers
 * on the spot, and landed in the shop — four of them in November; staff in the customer app
 * landed on consoles that binary does not carry. Each login now asks auth for its own kind of
 * account, a session in the wrong app is signed out with the reason, and a signed-out Ops
 * visitor opens on the login instead of the customer catalog.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, push, post, get, signOut } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
  signOut: vi.fn(),
}));
let search = '';
let pathname = '/login';
let customer: { id: string; role: string } | null = null;
let ready = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => pathname,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer, signIn: vi.fn(), signOut, ready }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, post, get } };
});
// The home page's own children fetch and need providers; what is tested there is its redirect.
vi.mock('@/lib/location-context', async () => ({
  ...(await vi.importActual<typeof import('@/lib/location-context')>('@/lib/location-context')),
  useLocation: () => ({ location: null }),
}));
vi.mock('@/components/hero', () => ({ Hero: () => null }));
vi.mock('@/components/promo-carousel', () => ({ PromoCarousel: () => null }));
vi.mock('@/components/category-grid', () => ({ CategoryGrid: () => null }));
vi.mock('@/components/nearby-depots', () => ({ NearbyDepots: () => null }));
vi.mock('@/components/loyalty-highlight', () => ({ LoyaltyHighlight: () => null }));
vi.mock('@/components/active-order-card', () => ({ ActiveOrderCard: () => null }));
vi.mock('@/components/product-rec-rail', () => ({ ProductRecRail: () => null }));

import { LocaleProvider } from '@/lib/locale-context';
import { AppAudienceGate } from '@/components/app-audience-gate';
import LoginPage from '@/app/login/page';
import HqLoginPage from '@/app/hq/login/page';
import ManagerLoginPage from '@/app/m/manager/login/page';

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  signOut.mockReset();
  post.mockReset().mockResolvedValue({ purpose: 'LOGIN', expiresInSeconds: 300 });
  // What /auth/me answers: the role the server holds now, whatever the phone has cached.
  get.mockReset().mockResolvedValue({ id: 'c1', role: 'CUSTOMER' });
  search = '';
  pathname = '/login';
  customer = null;
  ready = true;
});
afterEach(() => vi.unstubAllEnvs());

const inOpsApp = () => vi.stubEnv('NEXT_PUBLIC_MOBILE_APP', 'ops');
const inCustomerApp = () => vi.stubEnv('NEXT_PUBLIC_MOBILE_APP', 'customer');

/** Type a number into the door's phone field, submit, and return the body that was posted. */
async function sendNumber(inputId: string): Promise<unknown> {
  await userEvent.type(document.getElementById(inputId) as HTMLInputElement, '081234567890{enter}');
  await waitFor(() => expect(post).toHaveBeenCalled());
  return post.mock.calls[0]![1];
}

describe('the shared /login door', () => {
  it('asks for a STAFF account inside the Ops app, and offers no signup there', async () => {
    inOpsApp();
    const { container } = render(<LoginPage />, { wrapper: LocaleProvider });
    expect(container.querySelector('a[href^="/register"]')).toBeNull();
    expect(await sendNumber('phone')).toEqual({ phone: '081234567890', audience: 'STAFF' });
  });

  it('asks for a CUSTOMER account inside the customer app, signup included', async () => {
    inCustomerApp();
    const { container } = render(<LoginPage />, { wrapper: LocaleProvider });
    expect(container.querySelector('a[href^="/register"]')).not.toBeNull();
    expect(await sendNumber('phone')).toEqual({ phone: '081234567890', audience: 'CUSTOMER' });
  });

  it('asks for neither on the web, which serves both', async () => {
    const { container } = render(<LoginPage />, { wrapper: LocaleProvider });
    expect(container.querySelector('a[href^="/register"]')).not.toBeNull();
    expect(await sendNumber('phone')).toEqual({ phone: '081234567890' });
  });

  // HD-8: an unknown number is signed up through this door, so it carries the campaign codes.
  describe('with campaign codes kept in this browser', () => {
    beforeEach(() => {
      localStorage.setItem('hydromart.source', JSON.stringify({ first: 'pameran', last: 'qr-depot' }));
    });
    afterEach(() => {
      localStorage.removeItem('hydromart.source');
    });

    it('sends them from the customer app and the web', async () => {
      inCustomerApp();
      render(<LoginPage />, { wrapper: LocaleProvider });
      expect(await sendNumber('phone')).toEqual({
        phone: '081234567890',
        audience: 'CUSTOMER',
        firstSource: 'pameran',
        lastSource: 'qr-depot',
      });
    });

    it('keeps them out of the staff door, which never signs anyone up', async () => {
      inOpsApp();
      render(<LoginPage />, { wrapper: LocaleProvider });
      expect(await sendNumber('phone')).toEqual({ phone: '081234567890', audience: 'STAFF' });
    });
  });

  it('says why a session was sent back to it from the wrong app', async () => {
    inOpsApp();
    search = 'reason=not-staff';
    render(<LoginPage />, { wrapper: LocaleProvider });
    expect((await screen.findByRole('alert')).textContent).toMatch(/belum terdaftar sebagai staf/);
  });

  it('tells staff in the customer app to use Ops', async () => {
    inCustomerApp();
    search = 'reason=staff-account';
    render(<LoginPage />, { wrapper: LocaleProvider });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Hydromart Ops/);
  });
});

describe('the staff-only doors ask for a STAFF account on every build', () => {
  it('/hq/login', async () => {
    render(<HqLoginPage />, { wrapper: LocaleProvider });
    expect(await sendNumber('hq-phone')).toEqual({ phone: '081234567890', audience: 'STAFF' });
  });

  it('/m/manager/login', async () => {
    render(<ManagerLoginPage />, { wrapper: LocaleProvider });
    expect(await sendNumber('phone')).toEqual({ phone: '081234567890', audience: 'STAFF' });
  });
});

describe('AppAudienceGate', () => {
  // Navigate first, sign out once there: signing out first let the signed-out rule race the
  // redirect and land on a bare /login with no reason on it.
  it('sends a customer session to the login with the reason, and signs it out there', async () => {
    inOpsApp();
    customer = { id: 'c1', role: 'CUSTOMER' };
    pathname = '/products/';
    render(<AppAudienceGate />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=not-staff'));
    expect(signOut).not.toHaveBeenCalled();

    replace.mockReset();
    pathname = '/login/';
    render(<AppAudienceGate />);
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(replace).not.toHaveBeenCalled();
  });

  // The cache can be stale: HR inviting a customer promotes that same account to staff, and
  // offline the boot re-read fails and leaves the cache in place. No answer, no action.
  it('acts on the role the server confirms, never on the cached one', async () => {
    inOpsApp();
    customer = { id: 'c1', role: 'CUSTOMER' };
    pathname = '/products';

    get.mockResolvedValueOnce({ id: 'c1', role: 'STAFF_DEPOT' });
    render(<AppAudienceGate />);
    get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<AppAudienceGate />);

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('never offers a signup in the Ops app, signed in or not', async () => {
    inOpsApp();
    pathname = '/register';
    customer = { id: 's1', role: 'STAFF_DEPOT' };
    ready = false;
    render(<AppAudienceGate />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('opens the Ops app on the login, not the customer catalog, when nobody is signed in', async () => {
    inOpsApp();
    for (const away of ['/', '/products', '/register', '/checkout/']) {
      replace.mockReset();
      pathname = away;
      render(<AppAudienceGate />);
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    }
  });

  it('lets a signed-out visitor stay on the sign-in doors and the legal pages', () => {
    inOpsApp();
    for (const open of [
      '/login',
      '/verify/',
      '/syarat-ketentuan',
      '/kebijakan-privasi',
      '/hapus-akun',
    ]) {
      pathname = open;
      render(<AppAudienceGate />);
    }
    expect(replace).not.toHaveBeenCalled();
  });

  // RequireAuth sends those to the login itself, carrying the way back in `next`.
  it('leaves signed-out console screens to RequireAuth', () => {
    inOpsApp();
    for (const route of ['/dashboard/orders', '/driver', '/hr/me/check-in', '/m/manager/login']) {
      pathname = route;
      render(<AppAudienceGate />);
    }
    expect(replace).not.toHaveBeenCalled();
  });

  // Before `ready` the Keystore may still be locked, and nothing may ask the API anything.
  it('waits for the session to be ready before judging anything', () => {
    inOpsApp();
    ready = false;
    pathname = '/products';
    customer = { id: 'c1', role: 'CUSTOMER' };
    render(<AppAudienceGate />);
    customer = null;
    render(<AppAudienceGate />);
    expect(get).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves staff alone in the Ops app, and customers and visitors alone on the web', () => {
    inOpsApp();
    pathname = '/products';
    customer = { id: 's1', role: 'STAFF_DEPOT' };
    render(<AppAudienceGate />);
    vi.unstubAllEnvs();
    customer = { id: 'c1', role: 'CUSTOMER' };
    render(<AppAudienceGate />);
    customer = null;
    render(<AppAudienceGate />);
    expect(get).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('is mounted app-wide, inside the session provider', () => {
    const layout = readFileSync(join(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/<AuthProvider>[\s\S]*<AppAudienceGate \/>[\s\S]*<\/AuthProvider>/);
  });

  describe('in the customer app', () => {
    it('sends a staff session to the login, signs it out there, once the server confirms', async () => {
      inCustomerApp();
      customer = { id: 's1', role: 'KEPALA_DEPOT' };
      get.mockResolvedValue({ id: 's1', role: 'KEPALA_DEPOT' });
      pathname = '/products';
      render(<AppAudienceGate />);
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=staff-account'));
      expect(signOut).not.toHaveBeenCalled();

      replace.mockReset();
      pathname = '/login';
      render(<AppAudienceGate />);
      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
      expect(replace).not.toHaveBeenCalled();
    });

    it('leaves customers and signed-out visitors alone, signup included', async () => {
      inCustomerApp();
      customer = { id: 'c1', role: 'CUSTOMER' };
      pathname = '/products';
      render(<AppAudienceGate />);
      customer = null;
      for (const route of ['/', '/products', '/register']) {
        pathname = route;
        render(<AppAudienceGate />);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(get).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    // A cached staff role the server no longer holds is not acted on.
    it('acts only on the role the server confirms', async () => {
      inCustomerApp();
      customer = { id: 's1', role: 'STAFF_DEPOT' };
      pathname = '/products';
      render(<AppAudienceGate />);
      await waitFor(() => expect(get).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(replace).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
    });
  });
});

/*
 * The home page sends staff to their console — but only to one this binary carries. The
 * customer app has none: a route it does not serve is a blank screen with no way back, so the
 * redirect waits and AppAudienceGate signs the session out instead.
 */
describe('the home page redirect for staff', () => {
  async function homeIn(pruned: string, segments: string) {
    vi.stubEnv('NEXT_PUBLIC_MOBILE_PRUNED', pruned);
    vi.stubEnv('NEXT_PUBLIC_MOBILE_SEGMENTS', segments);
    vi.resetModules();
    const { default: HomePage } = await import('@/app/page');
    const { LocaleProvider: Locale } = await import('@/lib/locale-context');
    render(<HomePage />, { wrapper: Locale });
  }
  afterEach(() => vi.resetModules());

  it('goes to the console where the binary carries it', async () => {
    customer = { id: 's1', role: 'STAFF_DEPOT' };
    await homeIn('', '');
    const { consoleHome } = await import('@/lib/roles');
    await waitFor(() => expect(replace).toHaveBeenCalledWith(consoleHome('STAFF_DEPOT')));
  });

  it('stays put in the customer app, which carries no console', async () => {
    customer = { id: 's1', role: 'STAFF_DEPOT' };
    await homeIn(
      '/hq/*,/hr/*,/dashboard/*,/driver/*,/m/*,/resellers/*',
      'products,orders,checkout,account,login,verify,register',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replace).not.toHaveBeenCalled();
  });
});
