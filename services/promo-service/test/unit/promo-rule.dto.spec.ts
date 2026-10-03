import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AutoApplyQuoteDto, UpdatePromoRuleDto } from '../../src/modules/dto/promo-rule.dto';

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
