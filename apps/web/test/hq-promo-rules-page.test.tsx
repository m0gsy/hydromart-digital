// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch, del, toast, auth } = vi.hoisted(() => ({
  auth: { role: 'SUPER_ADMIN' as string },
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get, getCached: get, post, patch, del },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ customer: { role: auth.role } }) }));
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));

import { ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { LocaleProvider } from '@/lib/locale-context';
import { id as idDict } from '@/lib/dictionaries/id';
import type { PromoRule } from '@/lib/types';
import HqPromoRulesPage from '@/app/hq/promo-rules/page';

const T = idDict.hq.promoRules;
const DAYS = Object.values(T.days);

const RULE: PromoRule = {
  id: 'r-1',
  name: 'Diskon Senin',
  kind: 'SPECIAL_PRICE',
  depotId: 'depot-b',
  productId: 'prod-1',
  categoryId: null,
  specialPrice: 4000,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: null,
  percentOff: null,
  minSubtotal: null,
  discountAmount: null,
  giftProductId: null,
  firstOrderOnly: false,
  validFrom: '2026-01-05T00:00:00.000Z',
  validUntil: null,
  daysOfWeek: [1],
  startTime: '08:00',
  endTime: null,
  minQty: 2,
  maxQty: 10,
  channels: ['APP'],
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T03:04:05.000Z',
};
const BARE: PromoRule = {
  ...RULE,
  id: 'r-2',
  name: 'Gratis ongkir',
  kind: 'SHIPPING_DISCOUNT',
  depotId: null,
  productId: null,
  specialPrice: null,
  shippingFeeOverride: 0,
  percentOff: null,
  minSubtotal: null,
  discountAmount: null,
  giftProductId: null,
  firstOrderOnly: false,
  validFrom: null,
  daysOfWeek: [],
  startTime: null,
  minQty: 1,
  maxQty: null,
  channels: [],
  active: false,
};

/** The pickers read the catalogue, categories and depots; everything else is the rule list. */
const serve = (rules: PromoRule[], usage: unknown[] = []) =>
  get.mockReset().mockImplementation(async (path: string) => {
    const p = String(path);
    if (p === endpoints.promoRules.usage) return usage;
    const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 100 });
    if (p.includes('/products/api/v1/products')) {
      return page([{ id: 'prod-9', name: 'Galon 19L', basePrice: 8000, categoryId: 'cat-1' }]);
    }
    if (p.includes('/products/api/v1/categories')) return [{ id: 'cat-1', name: 'Air' }];
    if (p.includes('/depots/api/v1/depots')) return page([{ id: 'depot-z', name: 'Depot Z' }]);
    return rules;
  });

function renderPage(): void {
  render(
    <LocaleProvider>
      <HqPromoRulesPage />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  auth.role = 'SUPER_ADMIN';
  serve([RULE, BARE]);
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  del.mockReset().mockResolvedValue({});
  toast.mockReset();
});
afterEach(() => vi.clearAllMocks());

async function openNew(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(RULE.name);
  await user.click(screen.getByRole('button', { name: T.newRule }));
}

describe('hq/promo-rules list', () => {
  it('renders rows with kind + status badges and the dash fallback', async () => {
    renderPage();
    expect(await screen.findByText('Diskon Senin')).toBeTruthy();
    expect(screen.getByText('Gratis ongkir')).toBeTruthy();
    expect(screen.getByText('SPECIAL_PRICE')).toBeTruthy();
    expect(screen.getByText('SHIPPING_DISCOUNT')).toBeTruthy();
    expect(screen.getByText(T.active)).toBeTruthy();
    expect(screen.getByText(T.inactive)).toBeTruthy();
    expect(screen.getByText('depot-b · prod-1')).toBeTruthy();
    expect(screen.getByText('— · —')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(endpoints.promoRules.manage, true);
  });

  it('falls back to categoryId when there is no product', async () => {
    get.mockResolvedValue([{ ...RULE, productId: null, categoryId: 'cat-9' }]);
    renderPage();
    expect(await screen.findByText('depot-b · cat-9')).toBeTruthy();
  });

  it('shows the empty state for []', async () => {
    get.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(T.empty)).toBeTruthy();
  });

  it('shows the error state when the read fails, and retry reloads', async () => {
    const base = get.getMockImplementation()!;
    let failed = false;
    get.mockImplementation(async (path: string) => {
      if (path === endpoints.promoRules.manage && !failed) {
        failed = true;
        throw new ApiError(500, 'kaput');
      }
      return base(path);
    });
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('kaput')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText(RULE.name)).toBeTruthy();
    expect(get.mock.calls.filter(([path]) => path === endpoints.promoRules.manage)).toHaveLength(2);
  });
});

describe('hq/promo-rules editor', () => {
  it('opens the editor with all 7 weekday checkboxes and no crash', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    expect(screen.getByRole('heading', { name: T.editorNew })).toBeTruthy();
    for (const d of DAYS) expect(screen.getByRole('checkbox', { name: d })).toBeTruthy();
    expect(DAYS).toHaveLength(7);
    // a new rule has no "active" toggle
    expect(screen.queryByRole('checkbox', { name: T.fields.active })).toBeNull();
  });

  it('shows kind-specific fields only for the selected kind', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    const kind = screen.getByLabelText(T.fields.kind);

    expect(screen.getByLabelText(T.fields.specialPrice)).toBeTruthy();
    expect(screen.queryByLabelText(T.fields.buyQty)).toBeNull();
    expect(screen.queryByLabelText(T.fields.shippingFeeOverride)).toBeNull();

    await user.selectOptions(kind, 'BUY_X_GET_Y');
    expect(screen.getByLabelText(T.fields.buyQty)).toBeTruthy();
    expect(screen.getByLabelText(T.fields.getQty)).toBeTruthy();
    expect(screen.queryByLabelText(T.fields.specialPrice)).toBeNull();
    expect(screen.queryByLabelText(T.fields.shippingFeeOverride)).toBeNull();

    await user.selectOptions(kind, 'SHIPPING_DISCOUNT');
    expect(screen.getByLabelText(T.fields.shippingFeeOverride)).toBeTruthy();
    expect(screen.queryByLabelText(T.fields.buyQty)).toBeNull();
    expect(screen.queryByLabelText(T.fields.specialPrice)).toBeNull();
  });

  it('creates a BUY_X_GET_Y rule with the exact payload (no seenUpdatedAt)', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    await user.type(screen.getByLabelText(T.fields.name), '  Beli 5 gratis 1 ');
    await user.selectOptions(screen.getByLabelText(T.fields.kind), 'BUY_X_GET_Y');
    await user.type(screen.getByLabelText(T.fields.buyQty), '5');
    await user.type(screen.getByLabelText(T.fields.getQty), '1');
    await user.selectOptions(await screen.findByRole('option', { name: 'Depot Z' }).then(() => screen.getByLabelText(T.fields.depotId)), 'depot-z');
    await screen.findByRole('option', { name: 'Galon 19L' });
    await user.selectOptions(screen.getByLabelText(T.fields.productId), 'prod-9');
    await screen.findByRole('option', { name: 'Air' });
    await user.selectOptions(screen.getByLabelText(T.fields.categoryId), 'cat-1');
    await user.type(screen.getByLabelText(T.fields.validFrom), '2026-03-01');
    await user.type(screen.getByLabelText(T.fields.validUntil), '2026-03-31');
    await user.type(screen.getByLabelText(T.fields.startTime), '09:30');
    await user.type(screen.getByLabelText(T.fields.endTime), '17:00');
    await user.clear(screen.getByLabelText(T.fields.minQty));
    await user.type(screen.getByLabelText(T.fields.minQty), '3');
    await user.type(screen.getByLabelText(T.fields.maxQty), '20');
    await user.click(screen.getByRole('checkbox', { name: T.days[1] }));
    await user.click(screen.getByRole('checkbox', { name: T.days[3] }));
    await user.click(screen.getByRole('checkbox', { name: T.days[3] })); // toggled back off
    await user.click(screen.getByRole('checkbox', { name: T.days[5] }));
    await user.click(screen.getByRole('checkbox', { name: T.fields.channelApp }));
    await user.click(screen.getByRole('checkbox', { name: T.fields.channelCounter }));
    await user.click(screen.getByRole('checkbox', { name: T.fields.channelCounter })); // off again
    await user.click(screen.getByRole('button', { name: T.create }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      endpoints.promoRules.create,
      {
        name: 'Beli 5 gratis 1',
        kind: 'BUY_X_GET_Y',
        depotId: 'depot-z',
        productId: 'prod-9',
        categoryId: 'cat-1',
        specialPrice: null,
        buyQty: 5,
        getQty: 1,
        shippingFeeOverride: null,
        percentOff: null,
        minSubtotal: null,
        discountAmount: null,
        giftProductId: null,
        firstOrderOnly: false,
        validFrom: '2026-03-01T00:00:00.000Z',
        validUntil: '2026-03-31T00:00:00.000Z',
        daysOfWeek: [1, 5],
        startTime: '09:30',
        endTime: '17:00',
        minQty: 3,
        maxQty: 20,
        channels: ['APP'],
        active: true,
      },
      true,
    );
    expect(patch).not.toHaveBeenCalled();
    // editor closes and list reloads
    await waitFor(() => expect(screen.queryByRole('heading', { name: T.editorNew })).toBeNull());
    // The pickers read other endpoints too; only the rule list is reloaded.
    expect(get.mock.calls.filter(([path]) => path === endpoints.promoRules.manage)).toHaveLength(2);
  });

  it('creates SPECIAL_PRICE and SHIPPING_DISCOUNT rules with only their own field set', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    await user.type(screen.getByLabelText(T.fields.name), 'Harga');
    await user.type(screen.getByLabelText(T.fields.specialPrice), '4500');
    await user.click(screen.getByRole('button', { name: T.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      kind: 'SPECIAL_PRICE',
      specialPrice: 4500,
      buyQty: null,
      getQty: null,
      shippingFeeOverride: null,
      depotId: null,
      productId: null,
      categoryId: null,
      validFrom: null,
      startTime: null,
      maxQty: null,
      daysOfWeek: [],
      channels: [],
      minQty: 1,
    });

    await waitFor(() => expect(screen.queryByRole('heading', { name: T.editorNew })).toBeNull());
    await user.click(screen.getByRole('button', { name: T.newRule }));
    await user.type(screen.getByLabelText(T.fields.name), 'Ongkir');
    await user.selectOptions(screen.getByLabelText(T.fields.kind), 'SHIPPING_DISCOUNT');
    await user.type(screen.getByLabelText(T.fields.shippingFeeOverride), '0');
    await user.click(screen.getByRole('button', { name: T.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      kind: 'SHIPPING_DISCOUNT',
      shippingFeeOverride: 0,
      specialPrice: null,
      buyQty: null,
      getQty: null,
    });
  });

  it('rejects an empty name without calling the api', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    await user.click(screen.getByRole('button', { name: T.create }));
    expect(await screen.findByText(T.needName)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the ApiError message, or the generic text for other failures', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    await user.type(screen.getByLabelText(T.fields.name), 'X');

    post.mockRejectedValueOnce(new ApiError(500, 'boom'));
    await user.click(screen.getByRole('button', { name: T.create }));
    expect(await screen.findByText('boom')).toBeTruthy();

    post.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByRole('button', { name: T.create }));
    expect(await screen.findByText(T.saveError)).toBeTruthy();
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('pre-fills on Edit and PATCHes with seenUpdatedAt', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    await user.click(screen.getAllByRole('button', { name: T.edit })[0]!);

    expect(screen.getByRole('heading', { name: T.editorEdit })).toBeTruthy();
    expect((screen.getByLabelText(T.fields.name) as HTMLInputElement).value).toBe('Diskon Senin');
    expect((screen.getByLabelText(T.fields.specialPrice) as HTMLInputElement).value).toBe('4000');
    expect((screen.getByLabelText(T.fields.validFrom) as HTMLInputElement).value).toBe('2026-01-05');
    expect((screen.getByRole('checkbox', { name: T.days[1] }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: T.fields.channelApp }) as HTMLInputElement).checked).toBe(true);
    // the "new rule" button is hidden while editing
    expect(screen.queryByRole('button', { name: T.newRule })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: T.fields.active }));
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(
      endpoints.promoRules.detail('r-1'),
      {
        name: 'Diskon Senin',
        kind: 'SPECIAL_PRICE',
        depotId: 'depot-b',
        productId: 'prod-1',
        categoryId: null,
        specialPrice: 4000,
        buyQty: null,
        getQty: null,
        shippingFeeOverride: null,
        percentOff: null,
        minSubtotal: null,
        discountAmount: null,
        giftProductId: null,
        firstOrderOnly: false,
        validFrom: '2026-01-05T00:00:00.000Z',
        validUntil: null,
        daysOfWeek: [1],
        startTime: '08:00',
        endTime: null,
        minQty: 2,
        maxQty: 10,
        channels: ['APP'],
        active: false,
        seenUpdatedAt: RULE.updatedAt,
      },
      true,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('Cancel closes the editor without saving', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    await user.click(screen.getAllByRole('button', { name: T.edit })[1]!);
    expect((screen.getByLabelText(T.fields.shippingFeeOverride) as HTMLInputElement).value).toBe('0');
    await user.click(screen.getByRole('button', { name: T.cancel }));
    expect(screen.queryByRole('heading', { name: T.editorEdit })).toBeNull();
    expect(screen.getByRole('button', { name: T.newRule })).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('hq/promo-rules delete', () => {
  it('deletes via the detail endpoint then reloads the list', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    await user.click(screen.getAllByRole('button', { name: T.remove })[0]!);
    await waitFor(() =>
      expect(get.mock.calls.filter(([path]) => path === endpoints.promoRules.manage)).toHaveLength(2),
    );
    expect(del).toHaveBeenCalledWith(endpoints.promoRules.detail('r-1'), true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('toasts the ApiError message when delete fails, and the generic text otherwise', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    del.mockRejectedValueOnce(new ApiError(500, 'masih dipakai'));
    await user.click(screen.getAllByRole('button', { name: T.remove })[0]!);
    await waitFor(() => expect(toast).toHaveBeenCalledWith('masih dipakai', 'error'));

    del.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getAllByRole('button', { name: T.remove })[0]!);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(idDict.hq.common.actionFailed, 'error'));
  });
});

describe('hq/promo-rules write gating', () => {
  it('hides new/edit/remove for a read-only role', async () => {
    auth.role = 'HEAD_OFFICE';
    renderPage();
    await screen.findByText(RULE.name);
    expect(screen.queryByRole('button', { name: T.newRule })).toBeNull();
    expect(screen.queryByRole('button', { name: T.edit })).toBeNull();
    expect(screen.queryByRole('button', { name: T.remove })).toBeNull();
  });

  it('hides edit/remove on a network-wide rule for a depot-scoped writer only', async () => {
    get.mockResolvedValue([BARE]);
    auth.role = 'KEPALA_DEPOT';
    renderPage();
    await screen.findByText(BARE.name);
    expect(screen.getByRole('button', { name: T.newRule })).toBeTruthy();
    expect(screen.queryByRole('button', { name: T.edit })).toBeNull();
    expect(screen.queryByRole('button', { name: T.remove })).toBeNull();
  });

  it('keeps edit/remove on a network-wide rule for an unscoped writer', async () => {
    get.mockResolvedValue([BARE]);
    auth.role = 'MARKETING';
    renderPage();
    await screen.findByText(BARE.name);
    expect(screen.getByRole('button', { name: T.edit })).toBeTruthy();
    expect(screen.getByRole('button', { name: T.remove })).toBeTruthy();
  });
});

describe('hq/promo-rules · new kinds (item 5 #11)', () => {
  it('PERCENTAGE_OFF: asks for the percent and posts it', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    await user.type(screen.getByLabelText(T.fields.name), 'Diskon 20');
    await user.selectOptions(screen.getByLabelText(T.fields.kind), 'PERCENTAGE_OFF');
    await user.click(screen.getByRole('button', { name: T.create }));
    expect(await screen.findByText(T.needPercent)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(T.fields.percentOff), '20');
    await user.click(screen.getByRole('button', { name: T.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({ kind: 'PERCENTAGE_OFF', percentOff: 20, specialPrice: null });
  });

  it('ORDER_DISCOUNT: no product / category / quantity fields, amount or percent mode', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    await user.type(screen.getByLabelText(T.fields.name), 'Belanja 100rb');
    await user.selectOptions(screen.getByLabelText(T.fields.kind), 'ORDER_DISCOUNT');
    expect(screen.queryByLabelText(T.fields.productId)).toBeNull();
    expect(screen.queryByLabelText(T.fields.categoryId)).toBeNull();
    expect(screen.queryByLabelText(T.fields.minQty)).toBeNull();
    expect(screen.queryByLabelText(T.fields.maxQty)).toBeNull();

    await user.click(screen.getByRole('button', { name: T.create }));
    expect(await screen.findByText(T.needOrderDiscount)).toBeTruthy();

    await user.type(screen.getByLabelText(T.fields.minSubtotal), '100000');
    await user.type(screen.getByLabelText(T.fields.discountAmount), '10000');
    await user.click(screen.getByRole('button', { name: T.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      kind: 'ORDER_DISCOUNT',
      minSubtotal: 100000,
      discountAmount: 10000,
      percentOff: null,
      productId: null,
      minQty: 1,
      maxQty: null,
    });

    await openNew(user);
    await user.type(screen.getByLabelText(T.fields.name), 'Belanja 100rb persen');
    await user.selectOptions(screen.getByLabelText(T.fields.kind), 'ORDER_DISCOUNT');
    await user.selectOptions(screen.getByLabelText(T.fields.orderMode), 'PERCENT');
    expect(screen.queryByLabelText(T.fields.discountAmount)).toBeNull();
    await user.type(screen.getByLabelText(T.fields.minSubtotal), '50000');
    await user.type(screen.getByLabelText(T.fields.percentOff), '5');
    await user.click(screen.getByRole('button', { name: T.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]?.[1]).toMatchObject({ discountAmount: null, percentOff: 5, minSubtotal: 50000 });
  });

  it('BUNDLE_GIFT: needs a gift product, refuses the bought product as the gift, then posts', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    await user.type(screen.getByLabelText(T.fields.name), 'Beli 2 gratis botol');
    await user.selectOptions(screen.getByLabelText(T.fields.kind), 'BUNDLE_GIFT');
    await user.type(screen.getByLabelText(T.fields.buyQty), '2');
    await user.type(screen.getByLabelText(T.fields.giftQty), '1');
    await user.click(screen.getByRole('button', { name: T.create }));
    expect(await screen.findByText(T.needGift)).toBeTruthy();

    await screen.findAllByRole('option', { name: 'Galon 19L' });
    await user.selectOptions(screen.getByLabelText(T.fields.productId), 'prod-9');
    await user.selectOptions(screen.getByLabelText(T.fields.giftProductId), 'prod-9');
    await user.click(screen.getByRole('button', { name: T.create }));
    expect(await screen.findByText(T.giftSameProduct)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText(T.fields.productId), '');
    await user.click(screen.getByRole('button', { name: T.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      kind: 'BUNDLE_GIFT',
      buyQty: 2,
      getQty: 1,
      giftProductId: 'prod-9',
      productId: null,
    });
  });

  it('firstOrderOnly: unchecked by default, sent when ticked', async () => {
    const user = userEvent.setup();
    renderPage();
    await openNew(user);
    await user.type(screen.getByLabelText(T.fields.name), 'Pelanggan baru');
    await user.type(screen.getByLabelText(T.fields.specialPrice), '5000');
    const box = screen.getByRole('checkbox', { name: T.fields.firstOrderOnly }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await user.click(box);
    await user.click(screen.getByRole('button', { name: T.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[1]).toMatchObject({ firstOrderOnly: true });
  });

  it('editing a gift rule opens with its gift product and sends it back', async () => {
    const user = userEvent.setup();
    const gift = {
      ...RULE,
      id: 'r-gift',
      name: 'Hadiah',
      kind: 'BUNDLE_GIFT' as const,
      specialPrice: null,
      buyQty: 2,
      getQty: 1,
      giftProductId: 'prod-9',
      productId: null,
    };
    serve([gift]);
    renderPage();
    await screen.findByText('Hadiah');
    await user.click(screen.getByRole('button', { name: T.edit }));
    await screen.findAllByRole('option', { name: 'Galon 19L' });
    expect((screen.getByLabelText(T.fields.giftProductId) as HTMLSelectElement).value).toBe('prod-9');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ kind: 'BUNDLE_GIFT', giftProductId: 'prod-9', buyQty: 2, getQty: 1 });
  });
});

describe('hq/promo-rules · admin tools (item 5 D)', () => {
  const P = idDict.hq.promoTools;

  it('searches by name, narrows by kind and status, says when nothing matches, and resets', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    expect(screen.getByText(BARE.name)).toBeTruthy();

    await user.type(screen.getByLabelText(P.search), 'ongkir');
    expect(screen.queryByText(RULE.name)).toBeNull();
    expect(screen.getByText(BARE.name)).toBeTruthy();

    await user.clear(screen.getByLabelText(P.search));
    await user.selectOptions(screen.getByLabelText(P.statusFilter), 'active');
    expect(screen.getByText(RULE.name)).toBeTruthy();
    expect(screen.queryByText(BARE.name)).toBeNull(); // BARE is inactive

    await user.type(screen.getByLabelText(P.search), 'zzz-tidak-ada');
    expect(await screen.findByText(P.noMatch)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: P.clear }));
    expect(screen.getByText(RULE.name)).toBeTruthy();
    expect(screen.getByText(BARE.name)).toBeTruthy();
  });

  it('shows how often each rule fired, and "never used" for one that did not', async () => {
    serve([RULE, BARE], [{ promoRuleId: 'r-1', orders: 3, totalDiscount: 12000, lastAppliedAt: '2026-10-08T01:00:00.000Z' }]);
    renderPage();
    await screen.findByText(RULE.name);
    expect(await screen.findByText(/Dipakai di 3 pesanan/)).toBeTruthy();
    expect(screen.getByText(P.neverUsed)).toBeTruthy();
  });

  it('shows no usage at all when the usage read fails, and still lists the rules', async () => {
    const base = get.getMockImplementation()!;
    get.mockImplementation(async (path: string) => {
      if (path === endpoints.promoRules.usage) throw new Error('usage down');
      return base(path);
    });
    renderPage();
    expect(await screen.findByText(RULE.name)).toBeTruthy();
    expect(screen.queryByText(P.neverUsed)).toBeNull();
  });

  it('duplicates a rule into the editor as a NEW rule: copy name, create not patch', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    await user.click(screen.getAllByRole('button', { name: P.duplicate })[0]!);
    expect((screen.getByLabelText(T.fields.name) as HTMLInputElement).value).toBe(`${RULE.name} ${P.copySuffix}`);
    expect(screen.getByRole('heading', { name: T.editorNew })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: T.create }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(patch).not.toHaveBeenCalled();
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      name: `${RULE.name} ${P.copySuffix}`,
      kind: 'SPECIAL_PRICE',
      specialPrice: 4000,
      active: true,
    });
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('seenUpdatedAt');
  });

  it('cancelling a duplicate leaves no template behind for the next "new rule"', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    await user.click(screen.getAllByRole('button', { name: P.duplicate })[0]!);
    await user.click(screen.getByRole('button', { name: T.cancel }));
    await user.click(screen.getByRole('button', { name: T.newRule }));
    expect((screen.getByLabelText(T.fields.name) as HTMLInputElement).value).toBe('');
  });

  describe('simulator', () => {
    const SIM = {
      lines: [{ productId: 'prod-9', appliedRuleIds: ['r-1'], unitPriceAfter: 6000, freeQty: 1, lineTotal: 18000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
      orderDiscountRuleId: 'r-2',
      orderDiscountAmount: 2500,
      gifts: [{ promoRuleId: 'r-2', productId: 'prod-9', quantity: 2, triggerProductId: 'prod-9' }],
    };

    async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
      renderPage();
      await screen.findByText(RULE.name);
      await user.click(screen.getByRole('button', { name: P.openSimulator }));
      await screen.findAllByRole('option', { name: 'Galon 19L' });
      await user.selectOptions(screen.getByLabelText(P.product), 'prod-9');
      const qty = screen.getByLabelText(P.qty);
      await user.clear(qty);
      await user.type(qty, '3');
    }

    it('sends the basket to the simulate endpoint and shows what won, with rule names', async () => {
      const user = userEvent.setup();
      post.mockResolvedValueOnce(SIM);
      await openAndFill(user);
      await user.click(screen.getByRole('button', { name: P.run }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

      const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
      expect(path).toBe(endpoints.promoRules.simulate);
      expect(body).toMatchObject({
        channel: 'APP',
        firstOrder: false,
        lines: [{ productId: 'prod-9', categoryId: 'cat-1', quantity: 3, unitPrice: 8000 }],
      });
      expect(body.depotId).toBeUndefined(); // HQ: no depot chosen = network-wide rules only
      // The rule's name is in the list row AND on the result badge that names the winner.
      await waitFor(() => expect(screen.getAllByText(RULE.name).length).toBeGreaterThan(1));
      expect(screen.getByText('6.000', { exact: false })).toBeTruthy();
      expect(screen.getAllByText(P.orderDiscount).length).toBeGreaterThan(0);
      expect(screen.getByText(P.gift)).toBeTruthy();
    });

    it('sends the chosen channel, moment and new-customer flag', async () => {
      const user = userEvent.setup();
      post.mockResolvedValueOnce({ ...SIM, lines: [], orderDiscountAmount: 0, orderDiscountRuleId: null, gifts: [] });
      await openAndFill(user);
      await user.selectOptions(screen.getByLabelText(P.channel), 'COUNTER');
      await user.type(screen.getByLabelText(P.when), '2026-10-09T09:30');
      await user.click(screen.getByRole('checkbox', { name: P.newCustomer }));
      await user.click(screen.getByRole('button', { name: P.run }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body).toMatchObject({ channel: 'COUNTER', firstOrder: true });
      expect(new Date(body.occurredAt as string).getTime()).toBe(new Date('2026-10-09T09:30').getTime());
      expect(await screen.findByText(P.nothingApplied)).toBeTruthy();
    });

    it('asks for a product before calling the server', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText(RULE.name);
      await user.click(screen.getByRole('button', { name: P.openSimulator }));
      await user.click(screen.getByRole('button', { name: P.run }));
      expect(await screen.findByText(P.needLines)).toBeTruthy();
      expect(post).not.toHaveBeenCalled();
    });

    it('shows the server message when the simulation fails', async () => {
      const user = userEvent.setup();
      post.mockRejectedValueOnce(new ApiError(403, 'Tidak boleh'));
      await openAndFill(user);
      await user.click(screen.getByRole('button', { name: P.run }));
      expect(await screen.findByText('Tidak boleh')).toBeTruthy();
    });

    it('adds and removes basket lines, and closes', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText(RULE.name);
      await user.click(screen.getByRole('button', { name: P.openSimulator }));
      expect(screen.getAllByLabelText(P.product)).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: P.addLine }));
      expect(screen.getAllByLabelText(P.product)).toHaveLength(2);
      await user.click(screen.getAllByRole('button', { name: P.removeLine })[0]!);
      expect(screen.getAllByLabelText(P.product)).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: P.close }));
      expect(screen.getByRole('button', { name: P.openSimulator })).toBeTruthy();
    });
  });
});
