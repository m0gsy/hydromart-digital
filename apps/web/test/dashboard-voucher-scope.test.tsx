// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, del },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/require-auth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ customer: { id: 'u1', role: 'SUPER_ADMIN' }, ready: true }),
}));

import VouchersPage from '@/app/dashboard/vouchers/page';
import { endpoints } from '@/lib/endpoints';
import { id as idDict } from '@/lib/dictionaries/id';
import { LocaleProvider } from '@/lib/locale-context';
import type { Voucher } from '@/lib/types';

const PRODUCT = '0a1b2c3d-1111-4222-8333-444455556666';
const CATEGORY = '9f8e7d6c-1111-4222-8333-444455556666';
const S = idDict.hq.forms.voucher;
const H = idDict.hrFix.vouchers;

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

const serve = (vouchers: Voucher[]) =>
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p.includes('/products/api/v1/categories')) return [{ id: CATEGORY, name: 'Air' }];
    if (p.includes('/products/api/v1/products')) {
      return { items: [{ id: PRODUCT, name: 'Galon 19L' }], total: 1, page: 1, limit: 100 };
    }
    return { items: vouchers, total: vouchers.length, page: 1, limit: 50 };
  });

const draw = () =>
  render(
    <LocaleProvider>
      <VouchersPage />
    </LocaleProvider>,
  );

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  serve([voucher({}), voucher({ id: 'v-2', code: 'GALON10', productId: PRODUCT })]);
});
afterEach(() => vi.clearAllMocks());

describe('dashboard/vouchers · item scope (item 5 B)', () => {
  it('marks a scoped voucher in the list and leaves a whole-order one unmarked', async () => {
    draw();
    await screen.findByText('GALON10');
    expect(screen.getAllByText(new RegExp(S.scopedBadge))).toHaveLength(1);
  });

  it('creates a product-scoped voucher with the chosen product and no category', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: H.newVoucher }));
    await user.type(screen.getByPlaceholderText('HEMAT10'), 'galon20');
    await user.type(screen.getByPlaceholderText('10'), '20');
    await screen.findByRole('option', { name: 'Galon 19L' });
    await user.selectOptions(screen.getByLabelText(S.scopeProduct), PRODUCT);
    await user.click(screen.getByRole('button', { name: H.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe(endpoints.vouchers.create);
    expect(post.mock.calls[0]?.[1]).toMatchObject({ code: 'GALON20', productId: PRODUCT, categoryId: null });
  });

  it('a voucher with no scope is created as the whole order (both null)', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: H.newVoucher }));
    await user.type(screen.getByPlaceholderText('HEMAT10'), 'semua20');
    await user.type(screen.getByPlaceholderText('10'), '20');
    await user.click(screen.getByRole('button', { name: H.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({ productId: null, categoryId: null });
  });

  it('refuses both a product and a category before calling the server', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: H.newVoucher }));
    await user.type(screen.getByPlaceholderText('HEMAT10'), 'dua20');
    await user.type(screen.getByPlaceholderText('10'), '20');
    await screen.findByRole('option', { name: 'Galon 19L' });
    await screen.findByRole('option', { name: 'Air' });
    await user.selectOptions(screen.getByLabelText(S.scopeProduct), PRODUCT);
    await user.selectOptions(screen.getByLabelText(S.scopeCategory), CATEGORY);
    await user.click(screen.getByRole('button', { name: H.create }));
    expect(await screen.findByText(S.scopeBoth)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('editing opens with the saved scope and clearing it sends null', async () => {
    const user = userEvent.setup();
    draw();
    await screen.findByText('GALON10');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    await screen.findByRole('option', { name: 'Galon 19L' });
    const select = screen.getByLabelText(S.scopeProduct) as HTMLSelectElement;
    expect(select.value).toBe(PRODUCT);
    await user.selectOptions(select, '');
    await user.click(screen.getByRole('button', { name: H.save }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ productId: null, categoryId: null });
  });
});
