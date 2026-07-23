import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { OrderValueBatchDto } from '../../src/modules/dto/order.dto';

describe('OrderValueBatchDto', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it('accepts 1-500 unique order UUIDs', async () => {
    const dto = plainToInstance(OrderValueBatchDto, { orderIds: [id] });
    expect(await validate(dto)).toEqual([]);
  });

  it.each([
    { orderIds: [] },
    { orderIds: ['not-a-uuid'] },
    { orderIds: [id, id] },
    { orderIds: Array.from({ length: 501 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`) },
  ])('rejects invalid, duplicate, empty, or oversized input', async (body) => {
    expect(await validate(plainToInstance(OrderValueBatchDto, body))).not.toEqual([]);
  });
});
