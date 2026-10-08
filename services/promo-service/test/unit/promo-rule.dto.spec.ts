import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  AutoApplyApplyDto,
  AutoApplyQuoteDto,
  CreatePromoRuleDto,
  UpdatePromoRuleDto,
} from '../../src/modules/dto/promo-rule.dto';

describe('CreatePromoRuleDto', () => {
  const FULL_PAYLOAD = {
    name: 'Jumat Berkah',
    kind: 'BUY_X_GET_Y',
    depotId: '00000000-0000-4000-8000-000000000001',
    productId: '00000000-0000-4000-8000-000000000002',
    categoryId: '00000000-0000-4000-8000-000000000003',
    specialPrice: '6000',
    buyQty: '2',
    getQty: '1',
    shippingFeeOverride: '1000',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T00:00:00.000Z',
    daysOfWeek: ['5'],
    startTime: '09:00',
    endTime: '18:00',
    minQty: '2',
    maxQty: '10',
    channels: ['APP'],
  };

  it('accepts a fully-populated payload, coercing every numeric field', async () => {
    const dto = plainToInstance(CreatePromoRuleDto, FULL_PAYLOAD);
    expect(await validate(dto)).toEqual([]);
    expect(dto.specialPrice).toBe(6000);
    expect(dto.buyQty).toBe(2);
    expect(dto.getQty).toBe(1);
    expect(dto.shippingFeeOverride).toBe(1000);
    expect(dto.daysOfWeek).toEqual([5]);
    expect(dto.minQty).toBe(2);
    expect(dto.maxQty).toBe(10);
  });
});

describe('item 5 kind fields', () => {
  const base = { name: 'x', kind: 'PERCENTAGE_OFF' };
  const errorsFor = async (cls: new () => object, body: Record<string, unknown>) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('percentOff must be 1..99', async () => {
    expect(await errorsFor(CreatePromoRuleDto, { ...base, percentOff: 0 })).toContain('percentOff');
    expect(await errorsFor(CreatePromoRuleDto, { ...base, percentOff: 100 })).toContain('percentOff');
    expect(await errorsFor(CreatePromoRuleDto, { ...base, percentOff: 99 })).not.toContain('percentOff');
  });

  it('accepts the new kinds and rejects an unknown one', async () => {
    for (const kind of ['PERCENTAGE_OFF', 'ORDER_DISCOUNT', 'BUNDLE_GIFT']) {
      expect(await errorsFor(CreatePromoRuleDto, { name: 'x', kind })).not.toContain('kind');
    }
    expect(await errorsFor(CreatePromoRuleDto, { name: 'x', kind: 'TIERED' })).toContain('kind');
  });

  it('coerces the order-discount numbers and needs a UUID gift product', async () => {
    const dto = plainToInstance(CreatePromoRuleDto, {
      name: 'x',
      kind: 'ORDER_DISCOUNT',
      minSubtotal: '100000',
      discountAmount: '10000',
      firstOrderOnly: true,
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.minSubtotal).toBe(100000);
    expect(dto.discountAmount).toBe(10000);
    expect(await errorsFor(CreatePromoRuleDto, { name: 'x', kind: 'BUNDLE_GIFT', giftProductId: 'nope' })).toContain(
      'giftProductId',
    );
  });

  it('an explicit null firstOrderOnly on update is a 400, not a Prisma crash', async () => {
    expect(await errorsFor(UpdatePromoRuleDto, { firstOrderOnly: null })).toContain('firstOrderOnly');
    expect(await errorsFor(UpdatePromoRuleDto, { active: false })).toEqual([]);
  });

  it('quote lines accept skipPromo and the quote accepts firstOrder', async () => {
    const dto = plainToInstance(AutoApplyQuoteDto, {
      channel: 'APP',
      firstOrder: true,
      lines: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1, unitPrice: 8000, skipPromo: true }],
    });
    expect(await validate(dto)).toEqual([]);
    const bad = plainToInstance(AutoApplyQuoteDto, {
      channel: 'APP',
      lines: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1, unitPrice: 8000, skipPromo: 'yes' }],
    });
    expect(await validate(bad)).not.toEqual([]);
  });
});

describe('AutoApplyApplyDto · order discount and gifts (item 5)', () => {
  const ORDER = '00000000-0000-4000-8000-000000000001';
  const RULE = '00000000-0000-4000-8000-000000000002';
  const GIFT = '00000000-0000-4000-8000-000000000003';

  it('accepts and coerces an order discount and gift list', async () => {
    const dto = plainToInstance(AutoApplyApplyDto, {
      orderId: ORDER,
      lines: [],
      orderDiscountRuleId: RULE,
      orderDiscountAmount: '10000',
      gifts: [{ promoRuleId: RULE, productId: GIFT, value: '16000' }],
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.orderDiscountAmount).toBe(10000);
    expect(dto.gifts?.[0].value).toBe(16000);
  });

  it('rejects a malformed gift', async () => {
    const dto = plainToInstance(AutoApplyApplyDto, {
      orderId: ORDER,
      lines: [],
      gifts: [{ promoRuleId: 'nope', productId: GIFT, value: -1 }],
    });
    expect(await validate(dto)).not.toEqual([]);
  });
});

describe('specialPrice lower bound (>= 1)', () => {
  // A SPECIAL_PRICE of 0 would be indistinguishable from a BOGO free row to order-service's
  // collapsePromoFreeRows (unitPrice === 0), which would break the C8 replay guard.
  const base = { name: 'x', kind: 'SPECIAL_PRICE' };
  const errorsFor = async (cls: new () => object, body: Record<string, unknown>) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('rejects specialPrice 0 on create', async () => {
    expect(await errorsFor(CreatePromoRuleDto, { ...base, specialPrice: 0 })).toContain(
      'specialPrice',
    );
  });

  it('rejects specialPrice 0 on update (inherited from the create DTO)', async () => {
    expect(await errorsFor(UpdatePromoRuleDto, { specialPrice: 0 })).toContain('specialPrice');
  });

  it('still accepts specialPrice 1', async () => {
    expect(await errorsFor(CreatePromoRuleDto, { ...base, specialPrice: 1 })).not.toContain(
      'specialPrice',
    );
  });
});

describe('UpdatePromoRuleDto · name/kind null guard', () => {
  const errors = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdatePromoRuleDto, body))).map((e) => e.property);

  // `name`/`kind` are NOT NULL columns with no "clear" meaning. PartialType's default
  // @IsOptional() skips validation for `null` too, so this used to sail through and crash
  // Prisma with a raw 500 instead of a clean 400.
  it('rejects an explicit null name', async () => {
    expect(await errors({ name: null })).toContain('name');
  });

  it('rejects an explicit null kind', async () => {
    expect(await errors({ kind: null })).toContain('kind');
  });

  it('still allows omitting name/kind entirely (PATCH touches other fields only)', async () => {
    expect(await errors({ active: false })).toEqual([]);
  });

  it('still validates a provided name/kind normally', async () => {
    expect(await errors({ name: 'Baru', kind: 'SPECIAL_PRICE' })).toEqual([]);
    expect(await errors({ kind: 'NOT_A_KIND' })).toContain('kind');
  });

  // Same NOT NULL-at-the-DB-level guard, now applied to minQty/daysOfWeek/channels/active —
  // these all have DB defaults and no "clear to null" meaning either.
  it('rejects an explicit null minQty', async () => {
    expect(await errors({ minQty: null })).toContain('minQty');
  });

  it('rejects an explicit null daysOfWeek', async () => {
    expect(await errors({ daysOfWeek: null })).toContain('daysOfWeek');
  });

  it('rejects an explicit null channels', async () => {
    expect(await errors({ channels: null })).toContain('channels');
  });

  it('rejects an explicit null active', async () => {
    expect(await errors({ active: null })).toContain('active');
  });

  it('still allows omitting minQty/daysOfWeek/channels/active entirely', async () => {
    expect(await errors({ name: 'Baru' })).toEqual([]);
  });

  it('still validates a provided minQty/daysOfWeek/channels/active normally', async () => {
    expect(await errors({ minQty: 2, daysOfWeek: [5], channels: ['APP'], active: false })).toEqual([]);
    expect(await errors({ minQty: 0 })).toContain('minQty');
  });
});

describe('AutoApplyApplyDto · shipping field coercion', () => {
  // C-1: shippingUnits is new; shippingFeeOverride/originalShippingFee were already here.
  // Covers every numeric shipping field's string-to-number coercion end to end.
  it('coerces shippingFeeOverride/originalShippingFee/shippingUnits from strings', async () => {
    const dto = plainToInstance(AutoApplyApplyDto, {
      orderId: '00000000-0000-4000-8000-000000000001',
      lines: [],
      shippingFeeOverride: '1000',
      originalShippingFee: '2000',
      shippingUnits: '5',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.shippingFeeOverride).toBe(1000);
    expect(dto.originalShippingFee).toBe(2000);
    expect(dto.shippingUnits).toBe(5);
  });

  // D-1: shippingUnits: 0 is legitimate (a shipping-only order with no galon lines) — it
  // must be accepted, not rejected the way a true "no units" sentinel like `null` would be.
  it('accepts shippingUnits: 0 when originalShippingFee is set', async () => {
    const dto = plainToInstance(AutoApplyApplyDto, {
      orderId: '00000000-0000-4000-8000-000000000001',
      lines: [],
      originalShippingFee: '2000',
      shippingUnits: '0',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.shippingUnits).toBe(0);
  });

  it('rejects a negative shippingUnits', async () => {
    const dto = plainToInstance(AutoApplyApplyDto, {
      orderId: '00000000-0000-4000-8000-000000000001',
      lines: [],
      originalShippingFee: '2000',
      shippingUnits: '-1',
    });
    expect(await validate(dto)).not.toEqual([]);
  });

  // D-1: shippingUnits used to silently default to 1 when omitted — the exact bug class a
  // prior round fixed for the multiplier itself (C-1). Now, whenever the caller is sending
  // shipping-discount data at all (originalShippingFee present), shippingUnits is required.
  it('rejects omitting shippingUnits when originalShippingFee is set', async () => {
    const dto = plainToInstance(AutoApplyApplyDto, {
      orderId: '00000000-0000-4000-8000-000000000001',
      lines: [],
      originalShippingFee: '2000',
      // shippingUnits intentionally omitted
    });
    expect(await validate(dto)).not.toEqual([]);
  });

  it('allows omitting shippingUnits when there is no shipping data at all', async () => {
    const dto = plainToInstance(AutoApplyApplyDto, {
      orderId: '00000000-0000-4000-8000-000000000001',
      lines: [],
      // no originalShippingFee, no shippingUnits — order has no shipping-fee concept
    });
    expect(await validate(dto)).toEqual([]);
  });
});

describe('AutoApplyQuoteDto · nested cart-line validation', () => {
  const errors = async (body: Record<string, unknown>) =>
    validate(plainToInstance(AutoApplyQuoteDto, body));

  it('rejects a line with quantity 0', async () => {
    const result = await errors({
      channel: 'APP',
      lines: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 0, unitPrice: 8000 }],
    });
    expect(result).not.toEqual([]);
  });

  it('rejects a line with a negative unitPrice', async () => {
    const result = await errors({
      channel: 'APP',
      lines: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1, unitPrice: -1 }],
    });
    expect(result).not.toEqual([]);
  });

  it('accepts a well-formed line', async () => {
    const result = await errors({
      channel: 'APP',
      lines: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1, unitPrice: 8000 }],
    });
    expect(result).toEqual([]);
  });
});
