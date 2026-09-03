// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * K1.1 — the server tells /login and /register how long the code it just sent will live
 * (`expiresInSeconds`, five minutes) and both screens drop it on the floor.
 *
 * Half of the reported defect is already gone: E6 gave expiry its own error code and its
 * own Indonesian sentence, so an expired code no longer reads as a typo AFTER a guess.
 * What is left is everything BEFORE the guess: the screen never says the code has a life
 * at all, and when that life ends the one control that helps — "kirim ulang" — can still
 * be greyed out behind a cooldown that has nothing to do with expiry.
 */

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
const params = vi.hoisted(() => ({ current: new URLSearchParams() }));
const push = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: { post },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ signIn: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/verify',
  useSearchParams: () => params.current,
}));

import { LocaleProvider } from '@/lib/locale-context';
import LoginPage from '@/app/login/page';
import VerifyPage from '@/app/verify/page';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  params.current = new URLSearchParams();
  post.mockReset();
  push.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const view = (ui: React.ReactElement) => render(<LocaleProvider>{ui}</LocaleProvider>);

describe('OTP lifetime reaches the screen', () => {
  it('login carries the server expiry to /verify', async () => {
    post.mockResolvedValue({
      phoneMasked: '0811****90',
      expiresInSeconds: 300,
      resendCooldownSeconds: 60,
    });
    view(<LoginPage />);
    const input = screen.getByLabelText(/nomor|phone/i);
    await act(async () => {
      (input as HTMLInputElement).value = '081234567890';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      screen.getByRole('button', { name: /lanjut|kirim|masuk/i }).click();
    });
    const target = String(push.mock.calls[0]?.[0] ?? '');
    expect(target).toContain('exp=300');
  });

  it('/verify counts the code down and says the code has expired when it runs out', async () => {
    params.current = new URLSearchParams('phone=0811&purpose=LOGIN&cd=60&exp=2');
    view(<VerifyPage />);
    // Before it runs out the screen states the code is still alive.
    expect(screen.getByText(/berlaku/i)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/kedaluwarsa/i)).toBeTruthy();
  });

  it('an expired code releases the resend, whatever the cooldown said', async () => {
    params.current = new URLSearchParams('phone=0811&purpose=LOGIN&cd=600&exp=2');
    view(<VerifyPage />);
    const resend = screen.getByRole('button', { name: /kirim ulang|tunggu/i });
    expect((resend as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(
      (screen.getByRole('button', { name: /kirim ulang/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('a link opened without ?exp= behaves exactly as before — no countdown invented', () => {
    params.current = new URLSearchParams('phone=0811&purpose=LOGIN');
    view(<VerifyPage />);
    expect(screen.queryByText(/berlaku/i)).toBeNull();
  });
});

/*
 * K1.8 — /verify opened without a number (a stale link, a notification from before the
 * account was verified, a share) is one grey sentence on a screen with no app chrome and
 * no control of any kind. The sentence tells you to start again and gives you nothing to
 * start again WITH.
 */
describe('/verify with no number', () => {
  it('offers the way back it tells you to take', () => {
    params.current = new URLSearchParams();
    view(<VerifyPage />);
    const back = screen.getByRole('link', { name: /masuk|sign/i });
    expect(back.getAttribute('href')).toBe('/login');
  });
});
