// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post },
  ApiError: class ApiError extends Error {},
}));

import { CashierLiabilities } from '@/components/dashboard/cashier-liabilities';
import { ConfirmProvider } from '@/components/confirm';
import { endpoints } from '@/lib/endpoints';
import { LocaleProvider } from '@/lib/locale-context';

const shift = { id: 's-1', cashierName: '0812', closedAt: '2026-11-08T10:00:00.000Z', liabilityIdr: 50000 };

const draw = () =>
  render(
    <LocaleProvider>
      <ConfirmProvider>
        <CashierLiabilities depotId="d-1" />
      </ConfirmProvider>
    </LocaleProvider>,
  );

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  get.mockReset().mockResolvedValue([shift]);
});
afterEach(() => vi.clearAllMocks());

describe('CashierLiabilities (DEP-05)', () => {
  it('shows nothing when no liability is outstanding', async () => {
    get.mockResolvedValue([]);
    draw();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId('cashier-liabilities')).toBeNull();
  });

  it('lists an outstanding liability and settles it with the reason typed', async () => {
    const user = userEvent.setup();
    draw();
    expect(await screen.findByText('0812')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Selesaikan' }));
    await user.type(await screen.findByRole('textbox'), 'dilunasi tunai');
    await user.click(screen.getAllByRole('button', { name: /selesaikan/i }).at(-1)!);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(endpoints.cashierShifts.settleLiability('s-1'), { note: 'dilunasi tunai' }, true),
    );
  });

  it('says so when the settle fails', async () => {
    post.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    draw();
    await screen.findByText('0812');
    await user.click(screen.getByRole('button', { name: 'Selesaikan' }));
    await user.type(await screen.findByRole('textbox'), 'alasan');
    await user.click(screen.getAllByRole('button', { name: /selesaikan/i }).at(-1)!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Gagal/);
  });
});
