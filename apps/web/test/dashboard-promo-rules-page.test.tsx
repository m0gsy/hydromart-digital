// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, patch, del, toast } = vi.hoisted(() => ({
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
vi.mock('@/components/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/depot-context', () => ({ useDepot: () => ({ selectedId: 'depot-a' }) }));

import { ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { LocaleProvider } from '@/lib/locale-context';
import { id as idDict } from '@/lib/dictionaries/id';
import type { PromoRule } from '@/lib/types';
import DashboardPromoRulesPage from '@/app/dashboard/promo-rules/page';

const T = idDict.dashboard.promoRules;
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
  validFrom: null,
  daysOfWeek: [],
  startTime: null,
  minQty: 1,
  maxQty: null,
  channels: [],
  active: false,
};

function renderPage(): void {
  render(
    <LocaleProvider>
      <DashboardPromoRulesPage />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue([RULE, BARE]);
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

describe('dashboard/promo-rules list', () => {
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
    get.mockRejectedValueOnce(new ApiError(500, 'kaput'));
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('kaput')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText(RULE.name)).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('dashboard/promo-rules editor', () => {
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
    const depotField = screen.getByLabelText(T.fields.depotId) as HTMLInputElement;
    expect(depotField.disabled).toBe(true);
    expect(depotField.value).toBe('depot-a');
    await user.type(screen.getByLabelText(T.fields.productId), 'prod-9');
    await user.type(screen.getByLabelText(T.fields.categoryId), 'cat-1');
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
        depotId: 'depot-a',
        productId: 'prod-9',
        categoryId: 'cat-1',
        specialPrice: null,
        buyQty: 5,
        getQty: 1,
        shippingFeeOverride: null,
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
    expect(get).toHaveBeenCalledTimes(2);
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
      depotId: 'depot-a',
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

  it("keeps the rule's own depot on edit, never the active one (depot-a)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    await user.click(screen.getAllByRole('button', { name: T.edit })[0]!);
    const depotField = screen.getByLabelText(T.fields.depotId) as HTMLInputElement;
    expect(depotField.disabled).toBe(true);
    expect(depotField.value).toBe('depot-b');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ depotId: 'depot-b' });
  });

  it('keeps a network-wide rule network-wide on edit (depotId null)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    await user.click(screen.getAllByRole('button', { name: T.edit })[1]!);
    expect((screen.getByLabelText(T.fields.depotId) as HTMLInputElement).value).toBe('—');
    await user.click(screen.getByRole('button', { name: T.save }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[0]).toBe(endpoints.promoRules.detail('r-2'));
    expect(patch.mock.calls[0]?.[1]).toMatchObject({ depotId: null, seenUpdatedAt: BARE.updatedAt });
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

describe('dashboard/promo-rules delete', () => {
  it('deletes via the detail endpoint then reloads the list', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(RULE.name);
    await user.click(screen.getAllByRole('button', { name: T.remove })[0]!);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
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
    await waitFor(() => expect(toast).toHaveBeenCalledWith(idDict.common.error, 'error'));
  });
});
