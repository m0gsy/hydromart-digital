import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AiReferralRepository } from '../../src/application/ports/ai-referral.repository';
import { AiReferralService } from '../../src/application/services/ai-referral.service';
import { AiReferralPrismaRepository, AI_REFERRER_CAP } from '../../src/infrastructure/prisma/ai-referral.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AiReferralController } from '../../src/modules/ai-referral.controller';
import { AiReferralWindowDto } from '../../src/modules/dto/ai-referral.dto';

const FROM = new Date('2026-10-31T17:00:00.000Z');
const TO = new Date('2026-11-30T17:00:00.000Z');

describe('AiReferralPrismaRepository (O-06)', () => {
  const make = (groups: { c: number; r: number | null; e: number | null }[], invited = 9) => {
    const prisma = {
      referral: {
        count: jest.fn().mockResolvedValue(invited),
        groupBy: jest.fn().mockResolvedValue(groups.map((g, i) => ({ referrerCustomerId: `r${i}`, _count: { _all: g.c }, _sum: { referrerPoints: g.r, refereePoints: g.e } }))),
      },
    };
    return { prisma, repo: new AiReferralPrismaRepository(prisma as unknown as PrismaService) };
  };

  it('counts referrals made and qualified inside the window, with both sides points', async () => {
    const { prisma, repo } = make([{ c: 3, r: 150, e: 75 }, { c: 1, r: 50, e: 25 }]);
    await expect(repo.totals(FROM, TO)).resolves.toEqual({ invited: 9, qualified: 4, qualifiedReferrers: 2, referrerPoints: 200, refereePoints: 100 });
    expect(prisma.referral.count.mock.calls[0][0].where).toEqual({ createdAt: { gte: FROM, lt: TO } });
    expect(prisma.referral.groupBy.mock.calls[0][0].where).toEqual({ status: 'QUALIFIED', qualifiedAt: { gte: FROM, lt: TO } });
  });

  it('refuses with 422 past the referrer cap and asks for one row more than the cap', async () => {
    const { prisma, repo } = make(Array.from({ length: AI_REFERRER_CAP + 1 }, () => ({ c: 1, r: 1, e: 1 })));
    await expect(repo.totals(FROM, TO)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.referral.groupBy.mock.calls[0][0]).toMatchObject({ take: AI_REFERRER_CAP + 1, orderBy: { referrerCustomerId: 'asc' } });
  });

  it('answers 0 points when nothing qualified (a null sum is not a missing answer)', async () => {
    const { repo } = make([], 0);
    await expect(repo.totals(FROM, TO)).resolves.toEqual({ invited: 0, qualified: 0, qualifiedReferrers: 0, referrerPoints: 0, refereePoints: 0 });
    const { repo: nulls } = make([{ c: 1, r: null, e: null }], 0);
    await expect(nulls.totals(FROM, TO)).resolves.toMatchObject({ qualified: 1, referrerPoints: 0, refereePoints: 0 });
  });
});

describe('AiReferralService, controller and DTO', () => {
  it('hands the window to the repository as instants', async () => {
    const repo: AiReferralRepository = { totals: jest.fn().mockResolvedValue({ invited: 1, qualified: 0, qualifiedReferrers: 0, referrerPoints: 0, refereePoints: 0 }) };
    const c = new AiReferralController(new AiReferralService(repo));
    await expect(c.totals({ from: FROM.toISOString(), to: TO.toISOString() })).resolves.toMatchObject({ invited: 1 });
    expect(repo.totals).toHaveBeenCalledWith(FROM, TO);
  });

  it('accepts real instants in order and refuses everything else', async () => {
    const ok = (b: unknown) => validate(plainToInstance(AiReferralWindowDto, b));
    expect(await ok({ from: FROM.toISOString(), to: TO.toISOString() })).toHaveLength(0);
    expect((await ok({ from: TO.toISOString(), to: FROM.toISOString() })).length).toBeGreaterThan(0);
    expect((await ok({ from: '2026-02-30T00:00:00Z', to: TO.toISOString() })).length).toBeGreaterThan(0);
    expect((await ok({ from: FROM.toISOString(), to: '2028-01-01T00:00:00Z' })).length).toBeGreaterThan(0);
    expect((await ok({ from: FROM.toISOString() })).length).toBeGreaterThan(0);
  });
});
