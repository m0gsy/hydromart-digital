// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/depot-context', () => ({
  useDepot: () => ({ scopedId: 'd-1', depots: [{ id: 'd-1', name: 'Depot Satu' }], ready: true }),
}));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'mgr-1', role: 'MANAGER' }, ready: true }),
}));

import VouchersPage from '@/app/dashboard/vouchers/page';
import { ConfirmProvider } from '@/components/confirm';
import { id as idDict } from '@/lib/dictionaries/id';
import { LocaleProvider } from '@/lib/locale-context';
import type { Voucher } from '@/lib/types';

const H = idDict.hrFix.vouchers;
const S = idDict.hq.forms.voucher;

const voucher = (over: Partial<Voucher>): Voucher => ({
  id: 'v-1',
  code: 'SEMUA10',
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
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...over,
});

const draw = (vouchers: Voucher[]) => {
  // The editor's product and category pickers read their own lists (arrays), not the page.
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/products/api/v1/categories')) return [];
    if (p.includes('/products/api/v1/products')) return { items: [], total: 0, page: 1, limit: 100 };
    return { items: vouchers, total: vouchers.length, page: 1, limit: 50 };
  });
  return render(
    <LocaleProvider>
      <ConfirmProvider>
        <VouchersPage />
      </ConfirmProvider>
    </LocaleProvider>,
  );
};

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
});

/*
 * 2026-11-17 owner decision: a MANAGER runs the vouchers of the depots in their scope; a
 * network voucher is head office's. The server refuses the rest, so the till of buttons
 * follows it, and each row says where the code may be spent.
 */
describe('dashboard/vouchers for a depot-scoped manager', () => {
  it("offers no Beri/Edit/Nonaktifkan on head office's network voucher, and does on its own", async () => {
    draw([
      voucher({ id: 'net', code: 'NASIONAL', depotId: null }),
      voucher({ id: 'own', code: 'DEPOTKU', depotId: 'd-1' }),
    ]);
    await screen.findByText('NASIONAL');
    // Each row says where it is valid (the shared summary's badge).
    expect(screen.getByText(idDict.hq.vouchers.list.allDepots)).toBeTruthy();
    expect(screen.getByText('Depot Satu')).toBeTruthy();
    // Exactly one row is the manager's to edit.
    expect(screen.getAllByRole('button', { name: idDict.hq.vouchers.list.edit })).toHaveLength(1);
  });

  it('creates the voucher for the depot being worked in, valid to the end of the last WIB day', async () => {
    const user = userEvent.setup();
    const { container } = draw([]);
    await user.click(await screen.findByRole('button', { name: H.newVoucher }));
    // The depot being worked in is picked already, among the manager's own depots only.
    expect((screen.getByLabelText(S.depot) as HTMLSelectElement).value).toBe('d-1');
    await user.type(screen.getByPlaceholderText('HEMAT10'), 'depot20');
    await user.type(screen.getByPlaceholderText('10'), '20');
    const [from, until] = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(from!, { target: { value: '2026-11-01' } });
    fireEvent.change(until!, { target: { value: '2026-11-30' } });
    await user.click(screen.getByRole('button', { name: S.publish }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      code: 'DEPOT20',
      depotId: 'd-1',
      // 00:00 WIB on the 1st and the last millisecond of the 30th, not 07:00 UTC-midnight.
      validFrom: '2026-10-31T17:00:00.000Z',
      validUntil: '2026-11-30T16:59:59.999Z',
    });
  });
});
