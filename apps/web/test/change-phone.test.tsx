// @vitest-environment jsdom
/*
 * K1.4 — the number is the login identity and the one thing nobody could change. The
 * screen half: two steps, and a second step that sends only the code. Sending the number
 * again would mean a proof of one number could be spent on another, and this file is what
 * says the screen does not.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), patch: vi.fn() }));
const authMock = vi.hoisted(() => ({ signOut: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiError: class extends Error {},
  uploadFile: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    customer: { id: 'u-1', phone: '+6281234567890' },
    session: {},
    signIn: vi.fn(),
    signOut: authMock.signOut,
    ready: true,
  }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: toastMock }) }));

import { LocaleProvider } from '@/lib/locale-context';
import { ChangePhone } from '@/app/account/edit/change-phone';

const open = () => fireEvent.click(screen.getByRole('button', { name: /ganti nomor|change number/i }));
const click = (re: RegExp) => fireEvent.click(screen.getByRole('button', { name: re }));

function renderIt() {
  return render(
    <LocaleProvider>
      <ChangePhone currentPhone="+6281234567890" />
    </LocaleProvider>,
  );
}

/** Walks the flow to the point where a code has been sent. */
async function reachCodeStep() {
  apiMock.post.mockResolvedValueOnce({ phoneMasked: '+6289***210' });
  renderIt();
  open();
  fireEvent.change(screen.getByLabelText(/nomor hp baru|new phone number/i), {
    target: { value: '089876543210' },
  });
  click(/kirim kode|send code/i);
  await screen.findByLabelText(/kode verifikasi|verification code/i);
}

beforeEach(() => {
  apiMock.post.mockReset();
  authMock.signOut.mockReset();
  toastMock.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('K1.4 · changing the login identity', () => {
  it('shows the number and says out loud that it is the login', () => {
    renderIt();

    expect(screen.getByText('+6281234567890')).toBeTruthy();
    expect(screen.getByText(/dipakai untuk masuk|sign in with/i)).toBeTruthy();
  });

  it('sends a code to the new number and does not ask for the code before then', async () => {
    apiMock.post.mockResolvedValueOnce({ phoneMasked: '+6289***210' });
    renderIt();
    open();

    expect(screen.queryByLabelText(/kode verifikasi|verification code/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/nomor hp baru|new phone number/i), {
      target: { value: '089876543210' },
    });
    click(/kirim kode|send code/i);

    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    expect(apiMock.post.mock.calls[0]![0]).toBe('/auth/api/v1/auth/me/phone');
    expect(apiMock.post.mock.calls[0]![1]).toEqual({ phone: '089876543210' });
  });

  it('names the masked destination the server reports, not what was typed', async () => {
    await reachCodeStep();

    expect(screen.getByText(/\+6289\*\*\*210/)).toBeTruthy();
  });

  /*
   * The one that matters. The confirm request carries ONLY the code: the destination lives
   * on the server's stored challenge, and a code proves control of wherever it was
   * delivered. A screen that sent the number again would be handing the server a second,
   * unproved answer to the same question.
   */
  it('confirms with the code alone — never with the number again', async () => {
    await reachCodeStep();
    apiMock.post.mockResolvedValueOnce({ id: 'u-1', phone: '+6289876543210' });

    fireEvent.change(screen.getByLabelText(/kode verifikasi|verification code/i), {
      target: { value: '123456' },
    });
    click(/konfirmasi ganti nomor|confirm the change/i);

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
    expect(apiMock.post.mock.calls[1]![0]).toBe('/auth/api/v1/auth/me/phone/confirm');
    expect(apiMock.post.mock.calls[1]![1]).toEqual({ code: '123456' });
    expect(apiMock.post.mock.calls[1]![1]).not.toHaveProperty('phone');
  });

  // The server revokes every session on success, this one included. A screen that stayed
  // signed in would hold a token the server has already thrown away.
  it('signs out locally once the change lands', async () => {
    await reachCodeStep();
    apiMock.post.mockResolvedValueOnce({ id: 'u-1' });

    fireEvent.change(screen.getByLabelText(/kode verifikasi|verification code/i), {
      target: { value: '123456' },
    });
    click(/konfirmasi ganti nomor|confirm the change/i);

    await waitFor(() => expect(authMock.signOut).toHaveBeenCalled());
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/berhasil diganti|has been changed/i), 'success');
  });

  it('stays on the code step and says why when the code is refused', async () => {
    await reachCodeStep();
    apiMock.post.mockRejectedValueOnce(new Error('nope'));

    fireEvent.change(screen.getByLabelText(/kode verifikasi|verification code/i), {
      target: { value: '000000' },
    });
    click(/konfirmasi ganti nomor|confirm the change/i);

    expect(await screen.findByText(/gagal mengganti nomor|could not change the number/i)).toBeTruthy();
    expect(authMock.signOut).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/kode verifikasi|verification code/i)).toBeTruthy();
  });

  it('refuses to spend a request on an empty number', async () => {
    renderIt();
    open();

    click(/kirim kode|send code/i);

    expect(await screen.findByText(/isi nomor hp barunya|enter the new phone number/i)).toBeTruthy();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('refuses to confirm with an empty code', async () => {
    await reachCodeStep();

    click(/konfirmasi ganti nomor|confirm the change/i);

    expect(await screen.findByText(/isi kode yang dikirim|enter the code sent/i)).toBeTruthy();
    expect(apiMock.post).toHaveBeenCalledTimes(1);
  });

  it('says the send failed rather than moving on to a code that was never sent', async () => {
    apiMock.post.mockRejectedValueOnce(new Error('taken'));
    renderIt();
    open();
    fireEvent.change(screen.getByLabelText(/nomor hp baru|new phone number/i), {
      target: { value: '089876543210' },
    });
    click(/kirim kode|send code/i);

    expect(await screen.findByText(/gagal mengirim kode|could not send a code/i)).toBeTruthy();
    expect(screen.queryByLabelText(/kode verifikasi|verification code/i)).toBeNull();
  });

  it('cancelling puts everything back, including a half-typed number', async () => {
    await reachCodeStep();

    click(/^batal$|^cancel$/i);
    open();

    expect(screen.getByLabelText(/nomor hp baru|new phone number/i)).toHaveProperty('value', '');
  });
});
