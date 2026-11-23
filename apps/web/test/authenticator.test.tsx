// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, del, auth, toast, confirm, FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class FakeApiError extends Error {},
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  auth: { customer: { id: 'u-1', role: 'HEAD_OFFICE' } as { id: string; role: string } | null, ready: true },
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: { get, post, del }, ApiError: FakeApiError }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: auth.customer, ready: auth.ready }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/confirm', () => ({ useConfirm: () => ({ confirm }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/account/autentikator',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import AuthenticatorPage, { groupSecret } from '@/app/account/autentikator/page';
import { canResetTotp, ResetTotp } from '@/components/staff/staff-directory';

const status = (over: Record<string, unknown> = {}) => ({
  available: true,
  required: true,
  enrolled: false,
  recoveryCodesLeft: 0,
  lockedUntil: null,
  ...over,
});

beforeEach(() => {
  auth.customer = { id: 'u-1', role: 'HEAD_OFFICE' };
});
afterEach(() => vi.clearAllMocks());

const open = () => render(<AuthenticatorPage />, { wrapper: LocaleProvider });

describe('/account/autentikator (AI-3a)', () => {
  it('groups the secret the way authenticator apps print it', () => {
    expect(groupSecret('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')).toBe('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567');
  });

  it('says there is nothing to set up while the server has the step switched off', async () => {
    get.mockResolvedValue(status({ available: false }));
    open();
    expect(await screen.findByText(/belum dinyalakan di server/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pasang autentikator/i })).toBeNull();
  });

  it('sets up the app: secret and link, both codes, then the recovery codes once', async () => {
    get.mockResolvedValue(status());
    post.mockResolvedValueOnce({ secret: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP' });
    post.mockResolvedValueOnce({ recoveryCodes: ['aaaa-1111', 'bbbb-2222'] });
    open();
    expect(await screen.findByText(/wajib memakai langkah ini/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /pasang autentikator/i }));

    expect(await screen.findByText('ABCD EFGH IJKL MNOP')).toBeTruthy();
    expect(screen.getByRole('link', { name: /buka di aplikasi autentikator/i }).getAttribute('href')).toBe(
      'otpauth://totp/x?secret=ABCDEFGHIJKLMNOP',
    );

    // A wrong-shaped code is refused here, before the server spends a try on it.
    fireEvent.change(screen.getByLabelText(/kode dari aplikasi/i), { target: { value: '12345' } });
    fireEvent.change(screen.getByLabelText(/kode sms/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /selesaikan pemasangan/i }));
    expect(await screen.findByText(/harus 6 angka/)).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/kode dari aplikasi/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /selesaikan pemasangan/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toEqual({ code: '123456', smsCode: '654321' });

    expect(await screen.findByText('aaaa-1111')).toBeTruthy();
    get.mockResolvedValue(status({ enrolled: true, recoveryCodesLeft: 2 }));
    fireEvent.click(screen.getByRole('button', { name: /sudah saya simpan/i }));
    expect(await screen.findByText(/Kode pemulihan tersisa: 2/)).toBeTruthy();
    expect(screen.queryByText('aaaa-1111')).toBeNull();
  });

  // Review M1: the cached "not set up" status must not come back while the refetch runs.
  it('shows the new authenticator as set up at once, without waiting for the refetch', async () => {
    get.mockResolvedValueOnce(status());
    post.mockResolvedValueOnce({ secret: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/x' });
    post.mockResolvedValueOnce({ recoveryCodes: ['aaaa-1111', 'bbbb-2222', 'cccc-3333'] });
    open();
    fireEvent.click(await screen.findByRole('button', { name: /pasang autentikator/i }));
    fireEvent.change(await screen.findByLabelText(/kode dari aplikasi/i), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText(/kode sms/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /selesaikan pemasangan/i }));
    expect(await screen.findByText('aaaa-1111')).toBeTruthy();
    get.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /sudah saya simpan/i }));
    expect(await screen.findByText(/Kode pemulihan tersisa: 3/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pasang autentikator/i })).toBeNull();
  });

  // Review M2: five wrong codes lock it, during set-up too; the screen says until when.
  it('shows the server reason and the lock, and offers to start again', async () => {
    const until = new Date(Date.now() + 15 * 60_000).toISOString();
    get.mockResolvedValueOnce(status());
    post.mockResolvedValueOnce({ secret: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/x', sms: { expiresInSeconds: 300 } });
    post.mockRejectedValueOnce(new FakeApiError('Kode autentikator salah.'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /pasang autentikator/i }));
    expect(await screen.findByText(/berlaku 5 menit/)).toBeTruthy();
    get.mockResolvedValue(status({ lockedUntil: until }));
    fireEvent.change(screen.getByLabelText(/kode dari aplikasi/i), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText(/kode sms/i), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /selesaikan pemasangan/i }));
    expect(await screen.findByText('Kode autentikator salah.')).toBeTruthy();
    expect(screen.getByLabelText(/kode dari aplikasi/i).getAttribute('aria-invalid')).toBe('true');
    expect(await screen.findByText(/Terkunci sampai/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /mulai ulang/i })).toBeTruthy();
    expect((screen.getByRole('button', { name: /selesaikan pemasangan/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('warns that an optional set-up becomes required for that person', async () => {
    get.mockResolvedValue(status({ required: false }));
    open();
    expect(await screen.findByText(/hanya SUPER_ADMIN yang bisa melepasnya/)).toBeTruthy();
  });

  it('shows a set-up one as set up, and where a lost phone goes', async () => {
    get.mockResolvedValue(status({ enrolled: true, recoveryCodesLeft: 7 }));
    open();
    expect(await screen.findByText(/Kode pemulihan tersisa: 7/)).toBeTruthy();
    expect(screen.getByText(/Minta SUPER_ADMIN mereset/)).toBeTruthy();
  });

  it('asks nothing of a customer account', async () => {
    auth.customer = { id: 'c-1', role: 'CUSTOMER' };
    open();
    expect(await screen.findByText(/hanya untuk akun staf/)).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('ResetTotp on the staff directory (AI-3a)', () => {
  const staff = { id: 's-9', fullName: 'Rina', phone: '+6281200000000', role: 'FINANCE' } as never;

  it('resets after the confirmation, and says when there was nothing to reset', async () => {
    confirm.mockResolvedValue(true);
    del.mockResolvedValueOnce({ removed: true }).mockResolvedValueOnce({ removed: false });
    render(<ResetTotp staff={staff} />, { wrapper: LocaleProvider });
    fireEvent.click(screen.getByRole('button', { name: /reset autentikator/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Autentikator Rina direset.', 'success'));
    expect(del).toHaveBeenCalledWith('/auth/api/v1/auth/totp/s-9', true);
    fireEvent.click(screen.getByRole('button', { name: /reset autentikator/i }));
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith('Rina belum memasang autentikator.', 'info'));
  });

  it('is offered to SUPER_ADMIN only, never on their own row or a deleted account', () => {
    const admin = { id: 'a-1', role: 'SUPER_ADMIN' };
    expect(canResetTotp(admin, { id: 's-9', status: 'ACTIVE' } as never)).toBe(true);
    expect(canResetTotp(admin, { id: 'a-1', status: 'ACTIVE' } as never)).toBe(false);
    expect(canResetTotp(admin, { id: 's-9', status: 'DELETED' } as never)).toBe(false);
    expect(canResetTotp({ id: 'h-1', role: 'HEAD_OFFICE' }, { id: 's-9', status: 'ACTIVE' } as never)).toBe(false);
    expect(canResetTotp(null, { id: 's-9', status: 'ACTIVE' } as never)).toBe(false);
  });

  it('does nothing when the confirmation is declined', async () => {
    confirm.mockResolvedValue(false);
    render(<ResetTotp staff={staff} />, { wrapper: LocaleProvider });
    fireEvent.click(screen.getByRole('button', { name: /reset autentikator/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(del).not.toHaveBeenCalled();
  });
});
