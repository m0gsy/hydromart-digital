/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The login doors tell the server why the last session went, ask before spending an SMS on a
 * session the Keystore still holds, and settle the marker once a code has opened a new one.
 */
const { post, push, replace } = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn(), replace: vi.fn() }));
const store = vi.hoisted(() => ({
  hasStoredSession: vi.fn(() => false),
  unlockWasCancelled: vi.fn(() => false),
  hasTokens: vi.fn(() => true),
  retryUnlock: vi.fn(async () => {}),
}));

vi.mock('@/lib/token-store', () => store);
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: null, signIn: vi.fn(), ready: true }),
}));
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
vi.mock('@/components/otp-input', () => ({
  OtpInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="otp" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams('phone=081234567890&purpose=LOGIN'),
}));

import HqLoginPage from '@/app/hq/login/page';
import LoginPage from '@/app/login/page';
import VerifyPage from '@/app/verify/page';
import { LocaleProvider } from '@/lib/locale-context';

const MARKER = 'hm_session_drop';

beforeEach(() => {
  localStorage.clear();
  post.mockReset().mockResolvedValue({ challengeId: 'c', customer: { role: 'CUSTOMER' } });
  push.mockReset();
  replace.mockReset();
  store.hasStoredSession.mockReset().mockReturnValue(false);
  store.hasTokens.mockReset().mockReturnValue(true);
  store.retryUnlock.mockClear();
});
afterEach(cleanup);

const loginBody = () => post.mock.calls[0]![1] as Record<string, unknown>;

async function sendFromCustomerLogin() {
  render(<LoginPage />, { wrapper: LocaleProvider });
  fireEvent.change(screen.getByLabelText(/nomor telepon/i), { target: { value: '081234567890' } });
  fireEvent.submit(screen.getByLabelText(/nomor telepon/i).closest('form')!);
}

describe('/login', () => {
  it('sends the pending reason, and omits the key when there is none', async () => {
    await sendFromCustomerLogin();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(loginBody()).not.toHaveProperty('sessionDrop');

    cleanup();
    post.mockClear();
    localStorage.setItem(MARKER, 'refresh_refused');
    await sendFromCustomerLogin();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(loginBody()).toMatchObject({ sessionDrop: 'refresh_refused' });
  });

  it('with a stored session it asks first and sends nothing', async () => {
    store.hasStoredSession.mockReturnValue(true);
    await sendFromCustomerLogin();
    expect(await screen.findByText('Sesi kamu masih tersimpan')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('"Tetap pakai kode SMS" writes stored_skipped and sends it with the request', async () => {
    store.hasStoredSession.mockReturnValue(true);
    await sendFromCustomerLogin();
    fireEvent.click(await screen.findByRole('button', { name: 'Tetap pakai kode SMS' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(loginBody()).toMatchObject({ sessionDrop: 'stored_skipped' });
    expect(localStorage.getItem(MARKER)).toBe('stored_skipped');
  });

  it('"Buka sesi" opens the stored session and spends no SMS', async () => {
    store.hasStoredSession.mockReturnValue(true);
    vi.stubGlobal('location', { replace: vi.fn(), href: '/login/' });
    await sendFromCustomerLogin();
    const open = await screen.findAllByRole('button', { name: 'Buka sesi' });
    fireEvent.click(open[open.length - 1]!);
    await waitFor(() => expect(store.retryUnlock).toHaveBeenCalledTimes(1));
    expect(post).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('/hq/login (staff)', () => {
  async function submitPhone() {
    render(<HqLoginPage />, { wrapper: LocaleProvider });
    await userEvent.type(await screen.findByPlaceholderText('81234567890'), '81234567890');
    fireEvent.submit(screen.getByPlaceholderText('81234567890').closest('form')!);
  }

  it('sends audience STAFF with the pending reason', async () => {
    localStorage.setItem(MARKER, 'lock_sms');
    await submitPhone();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(loginBody()).toMatchObject({ audience: 'STAFF', sessionDrop: 'lock_sms' });
  });

  it('with a stored session it asks first; "Tetap" sends stored_skipped, "Buka sesi" sends nothing', async () => {
    store.hasStoredSession.mockReturnValue(true);
    await submitPhone();
    expect(await screen.findByText('Sesi kamu masih tersimpan')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    const open = screen.getAllByRole('button', { name: 'Buka sesi' });
    fireEvent.click(open[open.length - 1]!);
    await waitFor(() => expect(store.retryUnlock).toHaveBeenCalledTimes(1));
    expect(post).not.toHaveBeenCalled();

    fireEvent.submit(screen.getByPlaceholderText('81234567890').closest('form')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Tetap pakai kode SMS' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(loginBody()).toMatchObject({ audience: 'STAFF', sessionDrop: 'stored_skipped' });
  });
});

describe('after the code is verified', () => {
  async function verifyCode() {
    render(<VerifyPage />, { wrapper: LocaleProvider });
    await userEvent.type(screen.getByLabelText('otp'), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verifikasi/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  }

  it('a session that was captured clears the marker and remembers the phone had one', async () => {
    localStorage.setItem(MARKER, 'lock_sms');
    await verifyCode();
    await waitFor(() => expect(localStorage.getItem(MARKER)).toBeNull());
    expect(localStorage.getItem('hm_had_session')).toBe('1');
  });

  it('a response that captured no tokens leaves the marker alone', async () => {
    store.hasTokens.mockReturnValue(false);
    localStorage.setItem(MARKER, 'lock_sms');
    await verifyCode();
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(localStorage.getItem(MARKER)).toBe('lock_sms');
    expect(localStorage.getItem('hm_had_session')).toBeNull();
  });
});
