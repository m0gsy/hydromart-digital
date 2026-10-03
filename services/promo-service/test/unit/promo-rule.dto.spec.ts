import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AutoApplyQuoteDto } from '../../src/modules/dto/promo-rule.dto';

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
