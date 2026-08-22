// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post, push, FakeApiError } = vi.hoisted(() => ({
  post: vi.fn(),
  push: vi.fn(),
  FakeApiError: class FakeApiError extends Error {
    status: number;
    code: string;
    constructor(message: string, status = 400, code = 'BAD_REQUEST') {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/api', () => ({ api: { post }, ApiError: FakeApiError }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/register',
  useSearchParams: () => new URLSearchParams('next=%2Fcheckout'),
}));

import { LocaleProvider } from '@/lib/locale-context';
import RegisterPage from '@/app/register/page';

beforeEach(() => {
  post.mockReset();
  push.mockReset();
});
afterEach(() => vi.clearAllMocks());

/**
 * H11. The registration screen drew an avatar with a camera badge on it and the caption
 * "Tambahkan foto". There was no file input behind it and there could not be: the upload
 * endpoint is `/auth/me/avatar` and this screen has no token yet — register only mints an
 * OTP challenge. So the control was a picture of a control, and every tap did nothing.
 *
 * `/account/edit` has the real uploader. The lie is removed rather than half-built here.
 *
 * The same screen's "Lewati" dropped `next` on the floor, so someone who signed up mid-
 * checkout and skipped the extras landed in the catalogue with their cart behind them.
 */
describe('/register — the avatar that was a picture of an avatar', () => {
  it('makes no offer to add a photo it cannot accept', () => {
    render(<RegisterPage />, { wrapper: LocaleProvider });

    expect(screen.queryByText(/tambahkan foto|add a photo/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('keeps the destination when the visitor skips', () => {
    render(<RegisterPage />, { wrapper: LocaleProvider });

    const skip = screen.getByRole('link', { name: /lewati|skip/i });
    // `next` defaults to /products, so nothing changes for a visitor who arrived without
    // one. A gated destination still bounces at `RequireAuth`, which is the honest answer
    // to someone who has just declined to make an account.
    expect(skip).toHaveAttribute('href', '/checkout');
  });
});

/**
 * The two gates on this form. Both were unmeasured, and one of them is the consent record
 * UU PDP tahap 2 writes to the ledger — the tick is evidence, not an inference, so a form
 * that submitted without it would file a consent nobody gave.
 */
describe('/register — the gates on the form', () => {
  it('refuses to submit until consent is actually ticked', async () => {
    render(<RegisterPage />, { wrapper: LocaleProvider });

    await userEvent.type(screen.getByLabelText(/nomor|phone/i), '081234567890');
    const send = screen.getByRole('button', { name: /kirim kode verifikasi|send/i });
    expect(send).toBeDisabled();

    // The consent tick is the first checkbox; the second is the optional marketing opt-in,
    // which must never be what unlocks the form.
    await userEvent.click(screen.getAllByRole('checkbox')[1]!);
    expect(send).toBeDisabled();

    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(send).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends a number that already has an account to sign-in, with the number filled in', async () => {
    post.mockRejectedValue(new FakeApiError('sudah terdaftar', 409, 'AUTH_PHONE_TAKEN'));
    render(<RegisterPage />, { wrapper: LocaleProvider });

    await userEvent.type(screen.getByLabelText(/nomor|phone/i), '081234567890');
    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    await userEvent.click(screen.getByRole('button', { name: /kirim kode verifikasi|send/i }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const target = String(push.mock.calls[0]?.[0]);
    expect(target).toContain('/login?');
    expect(target).toContain('phone=081234567890');
    expect(target).toContain(encodeURIComponent('/checkout'));
  });
});
