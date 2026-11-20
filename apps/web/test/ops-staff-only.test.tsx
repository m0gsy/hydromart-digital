// @vitest-environment jsdom
/**
 * Owner decision 2026-11-20: the Ops app is staff-only. Staff whose HR record carried a wrong
 * number signed in on their real one, were signed up as customers on the spot, and landed in
 * the shop — four of them in November. The staff doors now ask auth for a STAFF account, and a
 * customer session that reaches the Ops app anyway is signed out with the reason.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, push, post, signOut } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  post: vi.fn(),
  signOut: vi.fn(),
}));
let search = '';
let customer: { id: string; role: string } | null = null;
let ready = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => '/login',
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer, signIn: vi.fn(), signOut, ready }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, post } };
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
  search = '';
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
  it('signs a customer session out of the Ops app and sends it to the login with the reason', async () => {
    inOpsApp();
    customer = { id: 'c1', role: 'CUSTOMER' };
    render(<OpsStaffOnly />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?reason=not-staff'));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  // A customer HR has just invited is promoted in place: the phone's cached profile says
  // CUSTOMER until the boot re-read of /auth/me lands, and that must not sign them out.
  it('waits for the server to confirm the role before acting on a cached profile', () => {
    inOpsApp();
    ready = false;
    customer = { id: 'c1', role: 'CUSTOMER' };
    render(<OpsStaffOnly />);
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('leaves staff alone in the Ops app, and customers alone on the web', () => {
    inOpsApp();
    customer = { id: 's1', role: 'STAFF_DEPOT' };
    render(<OpsStaffOnly />);
    vi.unstubAllEnvs();
    customer = { id: 'c1', role: 'CUSTOMER' };
    render(<OpsStaffOnly />);
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('is mounted app-wide, inside the session provider', () => {
    const layout = readFileSync(join(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/<AuthProvider>[\s\S]*<OpsStaffOnly \/>[\s\S]*<\/AuthProvider>/);
  });
});
