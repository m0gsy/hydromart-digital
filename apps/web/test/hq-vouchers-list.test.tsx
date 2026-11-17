// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/all-depots', () => ({
  fetchAllDepots: () => Promise.resolve([{ id: 'd-1', name: 'Depot Satu' }]),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'mkt-1', role: 'MARKETING' }, ready: true }),
}));

import HqVouchersPage from '@/app/hq/vouchers/page';
import { LocaleProvider } from '@/lib/locale-context';
import type { Voucher } from '@/lib/types';

const voucher = (o: Partial<Voucher>): Voucher => ({
  id: 'v',
  code: 'HEMAT10',
  description: null,
  discountType: 'PERCENTAGE',
  value: 10,
  minSpend: 0,
  maxDiscount: null,
  validFrom: null,
  validUntil: null,
  usageLimit: null,
  perCustomerLimit: 1,
  usedCount: 0,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

const listPaths: string[] = [];

beforeEach(() => {
  listPaths.length = 0;
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('burn-summary')) return { totalUsed: 50000, byVoucher: { live: 50000 } };
    if (p.includes('/vouchers?')) {
      listPaths.push(p);
      return {
        items: [
          voucher({ id: 'live', code: 'NASIONAL10', budgetCap: 500000, usageLimit: 100, usedCount: 7 }),
          voucher({ id: 'draft', code: 'DRAFTKU', active: false, audience: 'GRANTED', depotId: 'd-1' }),
        ],
        total: 2,
        page: 1,
        limit: 20,
      };
    }
    return [];
  });
});

const draw = () =>
  render(
    <LocaleProvider>
      <HqVouchersPage />
    </LocaleProvider>,
  );

/*
 * The HQ list read page one and dropped inactive rows in the browser, with no edit: a draft
 * vanished on save and a code past the 50th was unreachable.
 */
describe('/hq/vouchers', () => {
  it('lists a draft beside the live codes, with who may use each, where, and the budget', async () => {
    draw();
    const draft = (await screen.findByText('DRAFTKU')).closest('li')!;
    expect(within(draft).getByText('Nonaktif')).toBeTruthy();
    expect(within(draft).getByText('Khusus pelanggan')).toBeTruthy();
    expect(await within(draft).findByText('Depot Satu')).toBeTruthy();
    const live = screen.getByText('NASIONAL10').closest('li')!;
    expect(within(live).getByText('Semua depot')).toBeTruthy();
    expect(within(live).getByText('7 dari 100 terpakai')).toBeTruthy();
    expect(within(live).getByText('Diskon Rp 50.000 dari anggaran Rp 500.000')).toBeTruthy();
  });

  it('asks the server for the status and the search, not the browser', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('DRAFTKU');
    await user.click(screen.getByRole('tab', { name: 'Nonaktif' }));
    await waitFor(() => expect(listPaths.at(-1)).toContain('status=inactive'));
    await user.type(screen.getByLabelText('Cari kode atau keterangan'), 'hemat');
    await waitFor(() => expect(listPaths.at(-1)).toContain('q=hemat'));
  });

  it('opens the shared editor on a row', async () => {
    const user = userEvent.setup();
    draw();
    const row = (await screen.findByText('NASIONAL10')).closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Ubah' }));
    expect(within(row).getByText('Ubah voucher NASIONAL10')).toBeTruthy();
  });
});
