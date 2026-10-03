import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
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
