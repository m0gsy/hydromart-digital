import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AiLoyaltyRepository } from '../../src/application/ports/ai-loyalty.repository';
import { AiLoyaltyService, MAX_DEPOTS, MAX_SPANS } from '../../src/application/services/ai-loyalty.service';
import { AI_REDEEMER_CAP, AiLoyaltyPrismaRepository } from '../../src/infrastructure/prisma/ai-loyalty.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AiLoyaltyController } from '../../src/modules/ai-loyalty.controller';
import { AiPointsOutstandingQueryDto, AiRedemptionsDto } from '../../src/modules/dto/ai-loyalty.dto';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const FROM = new Date('2026-10-31T17:00:00.000Z');
const TO = new Date('2026-11-30T17:00:00.000Z');

const repo = (over: Partial<AiLoyaltyRepository> = {}): AiLoyaltyRepository => ({
  redemptions: jest.fn().mockResolvedValue({ redemptions: 0, points: 0, redeemers: 0, unplaced: 0 }),
  pointsOutstanding: jest.fn().mockResolvedValue({ accounts: 0, points: 0 }),
  ...over,
});

describe('AiLoyaltyService', () => {
  it('passes the spans through and refuses, rather than cuts, too many of them', async () => {
    const r = repo();
    const svc = new AiLoyaltyService(r);
    await svc.redemptions([{ depotId: D1, from: FROM, to: TO }]);
    expect(r.redemptions).toHaveBeenCalledTimes(1);
    const tooMany = Array.from({ length: MAX_SPANS + 1 }, () => ({ depotId: D1, from: FROM, to: TO }));
    expect(() => svc.redemptions(tooMany)).toThrow(UnprocessableEntityException);
    const manyDepots = Array.from({ length: MAX_DEPOTS + 1 }, (_, i) => ({
      depotId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      from: FROM,
      to: TO,
    }));
    expect(() => svc.redemptions(manyDepots)).toThrow(UnprocessableEntityException);
    expect(r.redemptions).toHaveBeenCalledTimes(1);
  });

  it('asks for the ledger before an instant', async () => {
    const r = repo({ pointsOutstanding: jest.fn().mockResolvedValue({ accounts: 3, points: 90 }) });
    await expect(new AiLoyaltyService(r).pointsOutstanding(TO)).resolves.toEqual({ accounts: 3, points: 90 });
    expect(r.pointsOutstanding).toHaveBeenCalledWith(TO);
  });
});

describe('AiLoyaltyPrismaRepository', () => {
  const grouped = (rows: { c: number; p: number | null }[]) =>
    rows.map((r, i) => ({ customerId: `c${i}`, _count: { _all: r.c }, _sum: { pointsSpent: r.p } }));

  it('counts handed-over redemptions inside the spans, one redeemer per person, and the ones with no depot', async () => {
    const prisma = {
      rewardRedemption: {
        groupBy: jest.fn().mockResolvedValue(grouped([{ c: 2, p: 300 }, { c: 1, p: null }, { c: 1, p: 50 }])),
        count: jest.fn().mockResolvedValue(4),
      },
    };
    const out = await new AiLoyaltyPrismaRepository(prisma as unknown as PrismaService).redemptions([
      { depotId: D1, from: FROM, to: TO },
      { depotId: D2, from: new Date('2026-11-10T00:00:00Z'), to: new Date('2026-12-05T00:00:00Z') },
    ]);
    expect(out).toEqual({ redemptions: 4, points: 350, redeemers: 3, unplaced: 4 });
    const where = prisma.rewardRedemption.groupBy.mock.calls[0][0].where;
    expect(where.status).toBe('USED');
    expect(where.OR).toEqual([
      { depotId: D1, usedAt: { gte: FROM, lt: TO } },
      { depotId: D2, usedAt: { gte: new Date('2026-11-10T00:00:00Z'), lt: new Date('2026-12-05T00:00:00Z') } },
    ]);
    // The unplaced count covers the whole window the spans reach, whatever depot they name.
    expect(prisma.rewardRedemption.count.mock.calls[0][0].where).toEqual({
      status: 'USED',
      depotId: null,
      usedAt: { gte: FROM, lt: new Date('2026-12-05T00:00:00Z') },
    });
  });

  it('answers zeros for no spans without touching the database', async () => {
    const prisma = { rewardRedemption: { groupBy: jest.fn(), count: jest.fn() } };
    await expect(new AiLoyaltyPrismaRepository(prisma as unknown as PrismaService).redemptions([])).resolves.toEqual({
      redemptions: 0,
      points: 0,
      redeemers: 0,
      unplaced: 0,
    });
    expect(prisma.rewardRedemption.groupBy).not.toHaveBeenCalled();
  });

  it('refuses, rather than counts a part of, more redeemers than it will group', async () => {
    const prisma = {
      rewardRedemption: {
        groupBy: jest.fn().mockResolvedValue(Array.from({ length: AI_REDEEMER_CAP + 1 }, (_, i) => ({ customerId: `c${i}`, _count: { _all: 1 }, _sum: { pointsSpent: 1 } }))),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    await expect(
      new AiLoyaltyPrismaRepository(prisma as unknown as PrismaService).redemptions([{ depotId: D1, from: FROM, to: TO }]),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.rewardRedemption.groupBy.mock.calls[0][0].take).toBe(AI_REDEEMER_CAP + 1);
  });

  it('sums the whole ledger and counts the accounts before an instant; an empty ledger is 0', async () => {
    const prisma = {
      loyaltyAccount: { count: jest.fn().mockResolvedValue(7) },
      pointsTransaction: { aggregate: jest.fn().mockResolvedValue({ _sum: { points: 1234 } }) },
    };
    const r = new AiLoyaltyPrismaRepository(prisma as unknown as PrismaService);
    await expect(r.pointsOutstanding(TO)).resolves.toEqual({ accounts: 7, points: 1234 });
    expect(prisma.loyaltyAccount.count.mock.calls[0][0].where).toEqual({ createdAt: { lt: TO } });
    expect(prisma.pointsTransaction.aggregate.mock.calls[0][0].where).toEqual({ createdAt: { lt: TO } });
    prisma.pointsTransaction.aggregate.mockResolvedValue({ _sum: { points: null } });
    await expect(r.pointsOutstanding(TO)).resolves.toEqual({ accounts: 7, points: 0 });
  });
});

describe('AiLoyaltyController and its DTOs', () => {
  it('turns the span strings into instants and asks the service', async () => {
    const ai = { redemptions: jest.fn().mockResolvedValue({ redemptions: 1 }), pointsOutstanding: jest.fn().mockResolvedValue({ accounts: 1 }) };
    const c = new AiLoyaltyController(ai as unknown as AiLoyaltyService);
    await c.redemptions({ spans: [{ depotId: D1, from: FROM.toISOString(), to: TO.toISOString() }] });
    expect(ai.redemptions).toHaveBeenCalledWith([{ depotId: D1, from: FROM, to: TO }]);
    await c.pointsOutstanding({ before: TO.toISOString() });
    expect(ai.pointsOutstanding).toHaveBeenCalledWith(TO);
  });

  const errors = async (body: unknown) => (await validate(plainToInstance(AiRedemptionsDto, body))).length;

  it('accepts real instants in order and refuses everything else', async () => {
    const span = { depotId: D1, from: FROM.toISOString(), to: TO.toISOString() };
    expect(await errors({ spans: [span] })).toBe(0);
    expect(await errors({ spans: [] })).toBeGreaterThan(0);
    expect(await errors({ spans: Array.from({ length: 201 }, () => span) })).toBeGreaterThan(0);
    expect(await errors({ spans: [{ ...span, from: '2026-02-30T00:00:00Z' }] })).toBeGreaterThan(0);
    expect(await errors({ spans: [{ ...span, from: TO.toISOString(), to: FROM.toISOString() }] })).toBeGreaterThan(0);
    expect(await errors({ spans: [{ ...span, to: '2028-01-01T00:00:00Z' }] })).toBeGreaterThan(0);
    expect(await errors({ spans: [{ ...span, depotId: 'x' }] })).toBeGreaterThan(0);
    const q = (before: string) => validate(plainToInstance(AiPointsOutstandingQueryDto, { before }));
    expect(await q(TO.toISOString())).toHaveLength(0);
    expect((await q('2026-13-01T00:00:00Z')).length).toBeGreaterThan(0);
  });
});
