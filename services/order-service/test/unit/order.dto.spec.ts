import { plainToInstance } from 'class-transformer';

import { SaveMeterReadingDto } from '../../src/modules/dto/meter-reading.dto';
import { validate } from 'class-validator';

import {
  CreateSubscriptionDto,
  ListOrdersQueryDto,
  OrderValueBatchDto,
  WalkInSaleDto,
} from '../../src/modules/dto/order.dto';
import { SetCartItemQuantityDto } from '../../src/modules/dto/cart.dto';

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
    {
      orderIds: Array.from(
        { length: 501 },
        (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      ),
    },
  ])('rejects invalid, duplicate, empty, or oversized input', async (body) => {
    expect(await validate(plainToInstance(OrderValueBatchDto, body))).not.toEqual([]);
  });
});

// Query strings and JSON bodies arrive as strings/plain objects; the @Type() factories are what
// turn them into numbers and nested class instances before class-validator sees them. Without a
// transform the decorators never run, so these are asserted on the transformed shape.
describe('request payload transforms', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it('coerces paging query strings to integers', async () => {
    const dto = plainToInstance(ListOrdersQueryDto, { page: '3', limit: '50' });
    expect(dto).toMatchObject({ page: 3, limit: 50 });
    expect(await validate(dto)).toEqual([]);
  });

  // ?unrouted=true arrives as a string; anything else must stay false so the tray
  // is never opened by accident.
  it.each([
    [{ unrouted: 'true' }, true],
    [{ unrouted: true }, true],
    [{ unrouted: 'false' }, false],
    [{ unrouted: '1' }, false],
  ])('reads the unrouted flag from %p', async (raw, expected) => {
    const dto = plainToInstance(ListOrdersQueryDto, raw);
    expect(dto.unrouted).toBe(expected);
    expect(await validate(dto)).toEqual([]);
  });

  it('coerces a cart quantity string to an integer', async () => {
    const dto = plainToInstance(SetCartItemQuantityDto, { quantity: '4' });
    expect(dto.quantity).toBe(4);
    expect(await validate(dto)).toEqual([]);
  });

  it('builds the nested delivery address of a subscription', async () => {
    const dto = plainToInstance(CreateSubscriptionDto, {
      productId: id,
      quantity: 2,
      frequency: 'WEEKLY',
      firstDeliveryAt: '2026-08-01T00:00:00.000Z',
      deliveryAddress: {
        recipientName: 'Budi',
        phone: '081234567890',
        addressLine: 'Jl. Merdeka 10',
        city: 'Bandung',
        province: 'Jawa Barat',
      },
    });
    expect(dto.deliveryAddress.city).toBe('Bandung');
    expect(await validate(dto)).toEqual([]);
  });

  it('builds walk-in sale lines and coerces their quantities', async () => {
    const dto = plainToInstance(WalkInSaleDto, {
      depotId: id,
      lines: [{ productId: id, quantity: '2' }],
    });
    expect(dto.lines[0].quantity).toBe(2);
    expect(await validate(dto)).toEqual([]);
  });
});

/*
 * The raw-water intake pair arrives from a form as strings. Both `@Type(() => Number)`
 * arrows have to run, or a reading typed at the tank is validated as text and stored as a
 * number nobody checked.
 */
describe('SaveMeterReadingDto — the optional intake pair', () => {
  it('coerces both intake readings and accepts three decimals', async () => {
    const dto = plainToInstance(SaveMeterReadingDto, {
      readingDate: '2026-08-14',
      sourceOpeningM3: '500.125',
      sourceClosingM3: '504',
    });
    expect(dto.sourceOpeningM3).toBeCloseTo(500.125);
    expect(dto.sourceClosingM3).toBe(504);
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property.startsWith('source'))).toEqual([]);
  });

  it('rejects an intake reading with more precision than the meter has', async () => {
    const dto = plainToInstance(SaveMeterReadingDto, {
      readingDate: '2026-08-14',
      sourceClosingM3: '504.12345',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sourceClosingM3')).toBe(true);
  });
});
