// @vitest-environment jsdom
/*
 * K1.5 — there was no customer-side complaint or dispute path anywhere in the app. The
 * support table has existed since design 15a and every verb on it belonged to staff; the
 * nearest thing a customer had was this page — an FAQ accordion, plus a WhatsApp button
 * that appears ONLY when their depot has filled in a contact number.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), getCached: vi.fn() }));
const auth = vi.hoisted(() => ({ customer: null as { id: string } | null }));

vi.mock('@/lib/api', () => ({ api: apiMock, ApiError: class extends Error {} }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: auth.customer, ready: true, signOut: vi.fn() }),
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/help',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import { Complaints } from '@/app/help/complaints';

const TICKET = {
  id: 't-1',
  subject: 'Galon bocor',
  status: 'ASSIGNED',
  orderRef: 'HM-260816-001',
  createdAt: '2026-08-25T10:00:00.000Z',
  messages: [
    { id: 'm-1', authorType: 'CUSTOMER', body: 'Bocor waktu diterima.', createdAt: '2026-08-25T10:00:00.000Z' },
    { id: 'm-2', authorType: 'STAFF', body: 'Kami kirim pengganti hari ini.', createdAt: '2026-08-25T11:00:00.000Z' },
  ],
};

const renderIt = () => render(<Complaints />, { wrapper: LocaleProvider });
const open = () => fireEvent.click(screen.getByRole('button', { name: /ajukan komplain|raise a complaint/i }));

beforeEach(() => {
  apiMock.get.mockReset().mockResolvedValue([]);
  apiMock.post.mockReset().mockResolvedValue(TICKET);
  auth.customer = { id: 'c-1' };
});
afterEach(() => vi.clearAllMocks());

describe('K1.5 · a customer can complain', () => {
  it('sends the complaint, and never a priority the complainant chose', async () => {
    renderIt();
    open();

    fireEvent.change(screen.getByLabelText(/ringkasan masalah|what went wrong/i), {
      target: { value: 'Galon bocor' },
    });
    fireEvent.change(screen.getByLabelText(/ceritakan|tell us what happened/i), {
      target: { value: 'Bocor waktu diterima.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /kirim komplain|send the complaint/i }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    const body = apiMock.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toEqual({ subject: 'Galon bocor', body: 'Bocor waktu diterima.' });
    // Everyone's own problem is urgent, so a self-selected priority sorts nothing.
    expect(body).not.toHaveProperty('priority');
    // The contact details are the server's business, read off the token.
    expect(body).not.toHaveProperty('customerPhone');
  });

  it('carries the order reference only when one was typed', async () => {
    renderIt();
    open();
    fireEvent.change(screen.getByLabelText(/ringkasan masalah|what went wrong/i), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/ceritakan|tell us what happened/i), { target: { value: 'B' } });
    fireEvent.change(screen.getByLabelText(/nomor pesanan|order number/i), {
      target: { value: 'HM-260816-001' },
    });
    fireEvent.click(screen.getByRole('button', { name: /kirim komplain|send the complaint/i }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    expect(apiMock.post.mock.calls[0]![1]).toMatchObject({ orderRef: 'HM-260816-001' });
  });

  it('refuses to send an empty complaint rather than filing a subject line', async () => {
    renderIt();
    open();

    fireEvent.click(screen.getByRole('button', { name: /kirim komplain|send the complaint/i }));

    expect(await screen.findByText(/isi ringkasan|say what went wrong/i)).toBeTruthy();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('says the send failed instead of closing as if it had worked', async () => {
    apiMock.post.mockRejectedValue(new Error('down'));
    renderIt();
    open();
    fireEvent.change(screen.getByLabelText(/ringkasan masalah|what went wrong/i), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/ceritakan|tell us what happened/i), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: /kirim komplain|send the complaint/i }));

    expect(await screen.findByText(/gagal mengirim komplain|could not send the complaint/i)).toBeTruthy();
  });
});

describe('K1.5 · and can see it again', () => {
  it('shows the complaint, its state, and what staff replied', async () => {
    apiMock.get.mockResolvedValue([TICKET]);

    renderIt();

    expect(await screen.findByText('Galon bocor')).toBeTruthy();
    expect(screen.getByText(/sedang ditangani|being handled/i)).toBeTruthy();
    expect(screen.getByText('Kami kirim pengganti hari ini.')).toBeTruthy();
  });

  it('says plainly that there are none yet', async () => {
    renderIt();

    expect(await screen.findByText(/belum ada komplain|no complaints yet/i)).toBeTruthy();
  });

  it('says the read failed rather than showing an empty list', async () => {
    apiMock.get.mockRejectedValue(new Error('down'));

    renderIt();

    // The shared `LoadError` — "Gagal dimuat." plus a retry — rather than a bespoke line.
    // An empty list here would read as "you have never complained", which is a lie.
    expect(await screen.findByText(/gagal dimuat|could not load\./i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /coba lagi|retry/i })).toBeTruthy();
  });

  /*
   * Signed-in only, and said plainly rather than by a disabled button. An unauthenticated
   * write is a spam surface, and a complaint nobody can reply to is worse than none.
   */
  it('asks a guest to sign in instead of taking a complaint nobody can answer', () => {
    auth.customer = null;

    renderIt();

    expect(screen.getByText(/masuk dulu untuk mengajukan|sign in first so we can reply/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ajukan komplain|raise a complaint/i })).toBeNull();
    expect(apiMock.get).not.toHaveBeenCalled();
  });
});

/**
 * H5, absorbed by K1.5. `/help` is linked from exactly two places: the account screen,
 * which a guest never gets past, and the footer, which is `hidden ... sm:block`. So on a
 * phone, a person who is not signed in has no route to the help page at all — and the help
 * page is where the depot's number is. The one audience most likely to need it was the one
 * audience that could not reach it.
 */
describe('H5 · a guest on a phone can reach /help', () => {
  it('the footer that carries the other link is desktop-only', async () => {
    // `process.cwd()` and not `import.meta.url`: this file runs under jsdom, where the
    // module URL is not a file: URL and `new URL(...)` throws.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(`${process.cwd()}/src/components/footer.tsx`, 'utf8'),
    );
    // Not a style preference — it is the reason the guest route had to exist elsewhere.
    expect(src).toMatch(/hidden[^"']*sm:block/);
  });

  it('the signed-out account screen offers it', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(`${process.cwd()}/src/app/account/page.tsx`, 'utf8'),
    );
    const guest = src.slice(src.indexOf('account.guestTitle'), src.indexOf('account.guestBody'));
    expect(guest).toContain('href="/help"');
  });
});
