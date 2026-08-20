// @vitest-environment jsdom
/**
 * Fase E — keamanan pintu masuk. Five holes that all live on the signed-out side of the
 * app, where no depot and no session exist yet, so none of them can be reached by a
 * server-side setting: what is asserted here is the whole safety net.
 *
 * E1 `next` was handed to the router raw, so anything that could put a link in front of
 *    a customer chose what the app navigated to — including another origin, inside the
 *    WebView, still wearing the app's chrome.
 * E2 the return path was rebuilt from `usePathname()`, which never carries a query, so
 *    every `?id=` link died at the login door. That is the notification-tap path.
 * E4 the client counted 30 seconds and the server counted 60, so the first honest resend
 *    was always refused.
 * E5 running out of OTP attempts left every control alive and nothing to do with them.
 * E8 an unknown number stopped at a dead end instead of continuing to registration.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, push, post } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  post: vi.fn(),
}));
/** The query string the page under test sees; set per test. */
let search = '';
let pathname = '/';
let customer: { id: string; role: string } | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => pathname,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer, signIn: vi.fn(), ready: true }),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, post } };
});
// One box instead of six: this suite is about what happens around the code, not about
// how the digits are typed. `otp-input.test.tsx` owns the widget itself.
vi.mock('@/components/otp-input', () => ({
  OtpInput: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <input
      aria-label="otp"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { ApiError } from '@/lib/api';
import { LocaleProvider } from '@/lib/locale-context';
import { RequireAuth } from '@/components/require-auth';
import VerifyPage from '@/app/verify/page';
import LoginPage from '@/app/login/page';
import RegisterPage from '@/app/register/page';

const SESSION = { customer: { id: 'c1', role: 'CUSTOMER' } };

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  post.mockReset().mockResolvedValue(SESSION);
  search = '';
  pathname = '/';
  customer = null;
  window.history.replaceState({}, '', '/');
});
afterEach(() => vi.clearAllMocks());

/** Type a code and submit it, whatever the surrounding chrome looks like. */
async function submitCode(code = '123456') {
  await userEvent.type(screen.getByLabelText('otp'), code);
  await userEvent.click(screen.getByRole('button', { name: /verifikasi/i }));
}

describe('E1 · `next` cannot name another origin', () => {
  it('refuses an absolute URL and lands the visitor somewhere in this app', async () => {
    search = 'phone=081234567890&purpose=LOGIN&next=https%3A%2F%2Fevil.example%2Fsteal';
    render(<VerifyPage />, { wrapper: LocaleProvider });
    await submitCode();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    const target = replace.mock.calls[0]![0] as string;
    expect(target).not.toContain('evil.example');
    expect(target.startsWith('/')).toBe(true);
    expect(target.startsWith('//')).toBe(false);
  });

  it('refuses the protocol-relative spelling of the same trick', async () => {
    search = 'phone=081234567890&purpose=LOGIN&next=%2F%2Fevil.example%2Fsteal';
    render(<VerifyPage />, { wrapper: LocaleProvider });
    await submitCode();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0]![0]).not.toContain('evil.example');
  });

  it('still honours an ordinary in-app destination', async () => {
    search = 'phone=081234567890&purpose=LOGIN&next=%2Forders%2Fdetail%3Fid%3Dord-1';
    render(<VerifyPage />, { wrapper: LocaleProvider });
    await submitCode();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/orders/detail?id=ord-1'));
  });
});

describe('E2 · the return path keeps its query string', () => {
  it('carries `?id=` through the login door', async () => {
    customer = null;
    pathname = '/orders/detail';
    window.history.replaceState({}, '', '/orders/detail?id=ord-1');

    render(
      <RequireAuth>
        <p>secret</p>
      </RequireAuth>,
      { wrapper: LocaleProvider },
    );

    await waitFor(() => expect(replace).toHaveBeenCalled());
    const target = replace.mock.calls[0]![0] as string;
    expect(decodeURIComponent(target)).toContain('/orders/detail?id=ord-1');
  });

  it('adds no stray `?` when there was no query to carry', async () => {
    customer = null;
    pathname = '/rewards';
    window.history.replaceState({}, '', '/rewards');

    render(
      <RequireAuth>
        <p>secret</p>
      </RequireAuth>,
      { wrapper: LocaleProvider },
    );

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0]![0]).toBe('/login?next=%2Frewards');
  });
});

describe('E4 · the resend clock is the server’s clock', () => {
  it('counts down from the cooldown the server issued, not a client guess', async () => {
    search = 'phone=081234567890&purpose=LOGIN&cd=60';
    render(<VerifyPage />, { wrapper: LocaleProvider });

    expect(screen.getByText(/Kirim ulang dalam 60d/)).toBeTruthy();
  });

  it('falls back to the server default when nothing was passed forward', async () => {
    search = 'phone=081234567890&purpose=LOGIN';
    render(<VerifyPage />, { wrapper: LocaleProvider });

    expect(screen.getByText(/Kirim ulang dalam 60d/)).toBeTruthy();
  });
});

describe('E5 · running out of attempts closes the code box', () => {
  it('disables the code entry and the submit once the challenge is spent', async () => {
    search = 'phone=081234567890&purpose=LOGIN';
    post.mockRejectedValue(
      new ApiError(429, 'Too many incorrect attempts. Please request a new code.', 'AUTH_OTP_MAX_ATTEMPTS'),
    );
    render(<VerifyPage />, { wrapper: LocaleProvider });
    await submitCode();

    await waitFor(() => expect(screen.getByLabelText('otp')).toHaveProperty('disabled', true));
    expect(screen.getByRole('button', { name: /verifikasi/i })).toHaveProperty('disabled', true);
  });

  it('leaves the box open for an ordinary wrong code', async () => {
    search = 'phone=081234567890&purpose=LOGIN';
    post.mockRejectedValue(new ApiError(401, 'salah', 'AUTH_OTP_INVALID'));
    render(<VerifyPage />, { wrapper: LocaleProvider });
    await submitCode();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByLabelText('otp')).toHaveProperty('disabled', false);
  });
});

describe('E8 · one door, whichever one you knocked on', () => {
  it('sends an unregistered number on to registration, number in hand', async () => {
    search = '';
    post.mockRejectedValue(
      new ApiError(404, 'No account is registered with this phone number.', 'AUTH_CUSTOMER_NOT_FOUND'),
    );
    render(<LoginPage />, { wrapper: LocaleProvider });

    await userEvent.type(screen.getByLabelText(/Nomor telepon/i), '081234567890');
    await userEvent.click(screen.getByRole('button', { name: /Kirim kode/i }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(push.mock.calls[0]![0]).toContain('/register?');
    expect(push.mock.calls[0]![0]).toContain('phone=081234567890');
  });

  it('sends an already-registered number back to sign-in, number in hand', async () => {
    search = '';
    post.mockRejectedValue(new ApiError(409, 'This phone number is already registered.', 'AUTH_PHONE_TAKEN'));
    render(<RegisterPage />, { wrapper: LocaleProvider });

    await userEvent.type(screen.getByLabelText(/Nomor telepon/i), '081234567890');
    await userEvent.click(screen.getByLabelText(/Kebijakan Privasi/i));
    await userEvent.click(screen.getByRole('button', { name: /Kirim kode verifikasi/i }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(push.mock.calls[0]![0]).toContain('/login?');
    expect(push.mock.calls[0]![0]).toContain('phone=081234567890');
  });

  it('prefills the number the other door handed over', () => {
    search = 'phone=081234567890';
    render(<RegisterPage />, { wrapper: LocaleProvider });
    expect(screen.getByLabelText(/Nomor telepon/i)).toHaveProperty('value', '081234567890');
  });
});
