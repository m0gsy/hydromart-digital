import { plainToInstance } from 'class-transformer';

import { BadRequestException } from '@nestjs/common';

import { GlobalValidationPipe } from '@hydromart/platform';

import { SaveMeterReadingDto } from '../../src/modules/dto/meter-reading.dto';
import { validate } from 'class-validator';

import {
  CounterQuoteDto,
  CreateSubscriptionDto,
  ListOrdersQueryDto,
  OrderValueBatchDto,
  WalkInLineDto,
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

/**
 * C12 · the quote request's shape, and the one thing it must NOT have.
 *
 * There is no phone field, deliberately: resolving a phone mints an account, so a quote
 * that accepted one would print a customer on every keystroke. The absence is the feature,
 * so it is asserted rather than left to be re-added by someone who finds it convenient.
 */
describe('CounterQuoteDto', () => {
  const valid = {
    depotId: '11111111-1111-4111-8111-111111111111',
    lines: [{ productId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
  };

  it('binds the nested lines rather than passing raw objects through', async () => {
    const dto = plainToInstance(CounterQuoteDto, valid);
    expect(dto.lines[0]).toBeInstanceOf(WalkInLineDto);
    expect(await validate(dto)).toEqual([]);
  });

  it('refuses an empty basket at the door', async () => {
    const dto = plainToInstance(CounterQuoteDto, { ...valid, lines: [] });
    expect(await validate(dto)).not.toEqual([]);
  });

  it('refuses a line the nested validator rejects', async () => {
    const dto = plainToInstance(CounterQuoteDto, {
      ...valid,
      lines: [{ productId: 'not-a-uuid', quantity: 0 }],
    });
    expect(await validate(dto)).not.toEqual([]);
  });

  /**
   * Run through the REAL pipe, not `plainToInstance`: it is `GlobalValidationPipe` that
   * decides what a route receives, and asserting the transform alone would have passed
   * while proving nothing.
   *
   * It turns out to be stronger than "the field is ignored": the pipe is
   * `forbidNonWhitelisted`, so a phone sent to the quote route is a 400. Pricing cannot be
   * made to resolve an identity even by a caller that tries.
   */
  it('REFUSES a phone somebody sends anyway — pricing cannot be made to create a customer', async () => {
    const pipe = new GlobalValidationPipe();

    await expect(
      pipe.transform(
        { ...valid, customerPhone: '081234567890' },
        { type: 'body', metatype: CounterQuoteDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the declared shape through the same pipe', async () => {
    const pipe = new GlobalValidationPipe();
    const body = (await pipe.transform(
      { ...valid, customerId: '33333333-3333-4333-8333-333333333333' },
      { type: 'body', metatype: CounterQuoteDto },
    )) as unknown as Record<string, unknown>;

    expect(body.depotId).toBe(valid.depotId);
    expect(body.customerId).toBe('33333333-3333-4333-8333-333333333333');
  });
});

/**
 * C6: `isWalkIn` arrives as a query STRING, so its coercion is where a filter quietly
 * becomes the wrong filter. Absent must stay absent — that is what keeps every existing
 * list unchanged; `"false"` must mean false rather than "a non-empty string is truthy",
 * which is the classic way a boolean query param inverts itself.
 */
describe('ListOrdersQueryDto · isWalkIn', () => {
  const parse = (raw: Record<string, unknown>) =>
    plainToInstance(ListOrdersQueryDto, raw) as unknown as { isWalkIn?: boolean };

  it('stays absent when nobody asked', () => {
    expect(parse({}).isWalkIn).toBeUndefined();
  });

  it('reads "true" as counter sales only', () => {
    expect(parse({ isWalkIn: 'true' }).isWalkIn).toBe(true);
  });

  it('reads "false" as delivery orders only, not as truthy', () => {
    expect(parse({ isWalkIn: 'false' }).isWalkIn).toBe(false);
  });

  it('accepts a real boolean too, for callers that send JSON', () => {
    expect(parse({ isWalkIn: true }).isWalkIn).toBe(true);
  });
});
