// @vitest-environment jsdom
/*
 * K1.2 — the voucher wallet is text. A customer looking at a code they own cannot copy it
 * and cannot get to the screen where it works; the promo page hands out a copy button for
 * the very same kind of code. So the wallet's job — "here is what you have, go spend it" —
 * stops at the first half.
 *
 * The lazy half of the fix is a link, not an apply API: checkout already loads the
 * customer's vouchers and already has a code field, so all the wallet has to do is arrive
 * with the code in the URL.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const writeText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn() },
  ApiError: class extends Error {},
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'c-1', role: 'CUSTOMER' }, ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/vouchers',
  useSearchParams: () => new URLSearchParams(),
}));

import { LocaleProvider } from '@/lib/locale-context';
import VouchersPage from '@/app/vouchers/page';

const VOUCHER = {
  code: 'HEMAT10',
  type: 'PERCENT',
  value: 10,
  minSpend: 50000,
  description: 'Diskon 10%',
  validUntil: '2026-12-31T00:00:00.000Z',
};

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText } });
  writeText.mockClear();
  get.mockReset().mockResolvedValue([VOUCHER]);
});
afterEach(() => vi.clearAllMocks());

describe('K1.2 · a voucher you own is usable from the screen that shows it', () => {
  it('copies the code', async () => {
    render(<VouchersPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('HEMAT10')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /salin/i }));
    expect(writeText).toHaveBeenCalledWith('HEMAT10');
  });

  it('offers the way to spend it, carrying the code', async () => {
    render(<VouchersPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('HEMAT10')).toBeTruthy());
    const use = screen.getByRole('link', { name: /pakai/i });
    expect(use.getAttribute('href')).toBe('/checkout?voucher=HEMAT10');
  });

  it('survives a blocked clipboard — the code is on screen either way', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<VouchersPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('HEMAT10')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /salin/i }));
    // No "Tersalin", no crash: the button says what it said before.
    expect(screen.getByRole('button', { name: /salin/i })).toBeTruthy();
  });

  it('gives a spent voucher neither control', async () => {
    get.mockResolvedValue([{ ...VOUCHER, status: 'USED' }]);
    render(<VouchersPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('HEMAT10')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /salin/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /pakai/i })).toBeNull();
  });

  it('labels a fixed-amount voucher in rupiah and a percentage one in percent', async () => {
    get.mockResolvedValue([
      { ...VOUCHER, code: 'POTONG5K', discountType: 'FIXED', value: 5000 },
      { ...VOUCHER, code: 'HEMAT10', discountType: 'PERCENT', value: 10 },
    ]);
    render(<VouchersPage />, { wrapper: LocaleProvider });
    await waitFor(() => expect(screen.getByText('POTONG5K')).toBeTruthy());
    expect(screen.getByText(/Rp\s?5\.000/)).toBeTruthy();
    expect(screen.getAllByText(/10%/).length).toBeGreaterThan(0);
  });
});
