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

  it('rejects a shippingUnits below 1', async () => {
    const dto = plainToInstance(AutoApplyApplyDto, {
      orderId: '00000000-0000-4000-8000-000000000001',
      lines: [],
      shippingUnits: '0',
    });
    expect(await validate(dto)).not.toEqual([]);
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
