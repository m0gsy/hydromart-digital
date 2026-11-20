// @vitest-environment jsdom
/**
 * Owner decision 2026-11-20: the Ops app is staff-only. Staff whose HR record carried a wrong
 * number signed in on their real one, were signed up as customers on the spot, and landed in
 * the shop — four of them in November. The staff doors now ask auth for a STAFF account, a
 * customer session that reaches the Ops app anyway is signed out with the reason, and a
 * signed-out visitor opens on the login instead of the customer catalog.
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

import { LocaleProvider } from '@/lib/locale-context';
import { OpsStaffOnly } from '@/components/ops-staff-only';
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

  it('stays the customer door on the web', async () => {
    const { container } = render(<LoginPage />, { wrapper: LocaleProvider });
    expect(container.querySelector('a[href^="/register"]')).not.toBeNull();
    expect(await sendNumber('phone')).toEqual({ phone: '081234567890' });
  });

  it('says why a customer session was sent back to it', async () => {
    inOpsApp();
    search = 'reason=not-staff';
    render(<LoginPage />, { wrapper: LocaleProvider });
    expect((await screen.findByRole('alert')).textContent).toMatch(/belum terdaftar sebagai staf/);
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

describe('OpsStaffOnly', () => {
  // Navigate first, sign out once there: signing out first let the signed-out rule race the
  // redirect and land on a bare /login with no reason on it.
  it('sends a customer session to the login with the reason, and signs it out there', async () => {
    inOpsApp();
    customer = { id: 'c1', role: 'CUSTOMER' };
    pathname = '/products/';
    render(<OpsStaffOnly />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=not-staff'));
    expect(signOut).not.toHaveBeenCalled();

    replace.mockReset();
    pathname = '/login/';
    render(<OpsStaffOnly />);
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
    render(<OpsStaffOnly />);
    get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<OpsStaffOnly />);

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
    render(<OpsStaffOnly />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('opens the Ops app on the login, not the customer catalog, when nobody is signed in', async () => {
    inOpsApp();
    for (const away of ['/', '/products', '/register', '/checkout/']) {
      replace.mockReset();
      pathname = away;
      render(<OpsStaffOnly />);
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
      render(<OpsStaffOnly />);
    }
    expect(replace).not.toHaveBeenCalled();
  });

  // RequireAuth sends those to the login itself, carrying the way back in `next`.
  it('leaves signed-out console screens to RequireAuth', () => {
    inOpsApp();
    for (const route of ['/dashboard/orders', '/driver', '/hr/me/check-in', '/m/manager/login']) {
      pathname = route;
      render(<OpsStaffOnly />);
    }
    expect(replace).not.toHaveBeenCalled();
  });

  // Before `ready` the Keystore may still be locked, and nothing may ask the API anything.
  it('waits for the session to be ready before judging anything', () => {
    inOpsApp();
    ready = false;
    pathname = '/products';
    customer = { id: 'c1', role: 'CUSTOMER' };
    render(<OpsStaffOnly />);
    customer = null;
    render(<OpsStaffOnly />);
    expect(get).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves staff alone in the Ops app, and customers and visitors alone on the web', () => {
    inOpsApp();
    pathname = '/products';
    customer = { id: 's1', role: 'STAFF_DEPOT' };
    render(<OpsStaffOnly />);
    vi.unstubAllEnvs();
    customer = { id: 'c1', role: 'CUSTOMER' };
    render(<OpsStaffOnly />);
    customer = null;
    render(<OpsStaffOnly />);
    expect(get).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('is mounted app-wide, inside the session provider', () => {
    const layout = readFileSync(join(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/<AuthProvider>[\s\S]*<OpsStaffOnly \/>[\s\S]*<\/AuthProvider>/);
  });
});
