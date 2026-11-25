import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AiEngagementRepository } from '../../src/application/ports/ai-engagement.repository';
import { AiEngagementService, MAX_DEPOTS, MAX_SPANS } from '../../src/application/services/ai-engagement.service';
import { AI_SUBSCRIBER_CAP, AiEngagementPrismaRepository } from '../../src/infrastructure/prisma/ai-engagement.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AiEngagementController } from '../../src/modules/ai-engagement.controller';
import { AiDiscountsDto, AiSubscriptionWindowDto } from '../../src/modules/dto/ai-engagement.dto';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const FROM = new Date('2026-10-31T17:00:00.000Z');
const TO = new Date('2026-11-30T17:00:00.000Z');

const repo = (over: Partial<AiEngagementRepository> = {}): AiEngagementRepository => ({
  discounts: jest.fn().mockResolvedValue({ orders: 0, discountedOrders: 0, discountIdr: 0 }),
  newSubscriptions: jest.fn().mockResolvedValue({ subscriptions: 0, subscribers: 0 }),
  ...over,
});

describe('AiEngagementService', () => {
  it('passes spans through and refuses, rather than cuts, too many of them', () => {
    const r = repo();
    const svc = new AiEngagementService(r);
    void svc.discounts([{ depotId: D1, from: FROM, to: TO }]);
    expect(r.discounts).toHaveBeenCalledTimes(1);
    expect(() => svc.discounts(Array.from({ length: MAX_SPANS + 1 }, () => ({ depotId: D1, from: FROM, to: TO })))).toThrow(
      UnprocessableEntityException,
    );
    const many = Array.from({ length: MAX_DEPOTS + 1 }, (_, i) => ({ depotId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, from: FROM, to: TO }));
    expect(() => svc.discounts(many)).toThrow(UnprocessableEntityException);
    expect(r.discounts).toHaveBeenCalledTimes(1);
  });

  it('asks for the subscriptions of a window', async () => {
    const r = repo({ newSubscriptions: jest.fn().mockResolvedValue({ subscriptions: 5, subscribers: 4 }) });
    await expect(new AiEngagementService(r).newSubscriptions(FROM, TO)).resolves.toEqual({ subscriptions: 5, subscribers: 4 });
    expect(r.newSubscriptions).toHaveBeenCalledWith(FROM, TO);
  });
});

describe('AiEngagementPrismaRepository (O-07, O-08)', () => {
  const dec = (n: number) => ({ toNumber: () => n });

  it('counts orders that count (not cancelled, not voided) inside each depot span, and sums their discount', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValueOnce({ _count: { _all: 10 } })
      .mockResolvedValueOnce({ _count: { _all: 4 }, _sum: { discount: dec(12500) } });
    const prisma = { order: { aggregate } };
    const out = await new AiEngagementPrismaRepository(prisma as unknown as PrismaService).discounts([
      { depotId: D1, from: FROM, to: TO },
      { depotId: D2, from: new Date('2026-11-10T00:00:00Z'), to: TO },
    ]);
    expect(out).toEqual({ orders: 10, discountedOrders: 4, discountIdr: 12500 });
    const w = aggregate.mock.calls[0][0].where;
    expect(w.status).toEqual({ notIn: ['CANCELLED', 'VOIDED'] });
    expect(w.OR).toEqual([
      { depotId: D1, createdAt: { gte: FROM, lt: TO } },
      { depotId: D2, createdAt: { gte: new Date('2026-11-10T00:00:00Z'), lt: TO } },
    ]);
    expect(aggregate.mock.calls[1][0].where.discount).toEqual({ gt: 0 });
  });

  it('answers 0 for no discounted order (a null sum), and nothing at all for no spans', async () => {
    const aggregate = jest.fn().mockResolvedValueOnce({ _count: { _all: 3 } }).mockResolvedValueOnce({ _count: { _all: 0 }, _sum: { discount: null } });
    const r = new AiEngagementPrismaRepository({ order: { aggregate } } as unknown as PrismaService);
    await expect(r.discounts([{ depotId: D1, from: FROM, to: TO }])).resolves.toEqual({ orders: 3, discountedOrders: 0, discountIdr: 0 });
    aggregate.mockClear();
    await expect(r.discounts([])).resolves.toEqual({ orders: 0, discountedOrders: 0, discountIdr: 0 });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('counts the plans made in the window and their distinct customers; refuses past the cap', async () => {
    const groupBy = jest.fn().mockResolvedValue([{ customerId: 'a' }, { customerId: 'b' }]);
    const count = jest.fn().mockResolvedValue(3);
    const r = new AiEngagementPrismaRepository({ subscription: { count, groupBy } } as unknown as PrismaService);
    await expect(r.newSubscriptions(FROM, TO)).resolves.toEqual({ subscriptions: 3, subscribers: 2 });
    expect(count.mock.calls[0][0].where).toEqual({ createdAt: { gte: FROM, lt: TO } });
    expect(groupBy.mock.calls[0][0].take).toBe(AI_SUBSCRIBER_CAP + 1);
    groupBy.mockResolvedValue(Array.from({ length: AI_SUBSCRIBER_CAP + 1 }, (_, i) => ({ customerId: `c${i}` })));
    await expect(r.newSubscriptions(FROM, TO)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('AiEngagementController and DTOs', () => {
  it('turns span strings into instants', async () => {
    const r = repo();
    const c = new AiEngagementController(new AiEngagementService(r));
    await c.discounts({ spans: [{ depotId: D1, from: FROM.toISOString(), to: TO.toISOString() }] });
    expect(r.discounts).toHaveBeenCalledWith([{ depotId: D1, from: FROM, to: TO }]);
    await c.subscriptions({ from: FROM.toISOString(), to: TO.toISOString() });
    expect(r.newSubscriptions).toHaveBeenCalledWith(FROM, TO);
  });

  it('validates real, ordered instants only', async () => {
    const span = { depotId: D1, from: FROM.toISOString(), to: TO.toISOString() };
    const spans = async (b: unknown) => (await validate(plainToInstance(AiDiscountsDto, b))).length;
    expect(await spans({ spans: [span] })).toBe(0);
    expect(await spans({ spans: [] })).toBeGreaterThan(0);
    expect(await spans({ spans: Array.from({ length: 201 }, () => span) })).toBeGreaterThan(0);
    expect(await spans({ spans: [{ ...span, from: '2026-02-30T00:00:00Z' }] })).toBeGreaterThan(0);
    expect(await spans({ spans: [{ ...span, from: TO.toISOString(), to: FROM.toISOString() }] })).toBeGreaterThan(0);
    expect(await spans({ spans: [{ ...span, to: '2028-01-01T00:00:00Z' }] })).toBeGreaterThan(0);
    const win = async (b: unknown) => (await validate(plainToInstance(AiSubscriptionWindowDto, b))).length;
    expect(await win({ from: FROM.toISOString(), to: TO.toISOString() })).toBe(0);
    expect(await win({ from: TO.toISOString(), to: FROM.toISOString() })).toBeGreaterThan(0);
    expect(await win({ from: FROM.toISOString() })).toBeGreaterThan(0);
  });
});
