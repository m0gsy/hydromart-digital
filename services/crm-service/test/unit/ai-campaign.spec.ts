import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AiCampaignRepository } from '../../src/application/ports/ai-campaign.repository';
import { AiCampaignService } from '../../src/application/services/ai-campaign.service';
import { AiCampaignPrismaRepository } from '../../src/infrastructure/prisma/ai-campaign.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AiCampaignController } from '../../src/modules/ai-campaign.controller';
import { AiCampaignWindowDto } from '../../src/modules/dto/ai-campaign.dto';

const FROM = new Date('2026-10-31T17:00:00.000Z');
const TO = new Date('2026-11-30T17:00:00.000Z');

describe('AiCampaignPrismaRepository (O-09)', () => {
  const make = (rows: { status: string; n: number }[], campaigns = 2) => {
    const prisma = {
      campaign: { count: jest.fn().mockResolvedValue(campaigns) },
      campaignRecipient: { groupBy: jest.fn().mockResolvedValue(rows.map((r) => ({ status: r.status, _count: { _all: r.n } }))) },
    };
    return { prisma, repo: new AiCampaignPrismaRepository(prisma as unknown as PrismaService) };
  };

  it('counts finished campaigns by the instant they finished, and their recipients by outcome', async () => {
    const { prisma, repo } = make([
      { status: 'SENT', n: 90 },
      { status: 'FAILED', n: 4 },
      { status: 'SKIPPED', n: 5 },
      { status: 'PENDING', n: 1 },
    ]);
    await expect(repo.totals(FROM, TO)).resolves.toEqual({ campaigns: 2, sent: 90, failed: 4, skipped: 5, other: 1 });
    const where = { status: { in: ['SENT', 'COMPLETED_WITH_FAILURES'] }, sentAt: { gte: FROM, lt: TO } };
    expect(prisma.campaign.count.mock.calls[0][0].where).toEqual(where);
    expect(prisma.campaignRecipient.groupBy.mock.calls[0][0].where).toEqual({ campaign: where });
  });

  it('answers zeros when no campaign finished', async () => {
    const { repo } = make([], 0);
    await expect(repo.totals(FROM, TO)).resolves.toEqual({ campaigns: 0, sent: 0, failed: 0, skipped: 0, other: 0 });
  });
});

describe('AiCampaignService, controller and DTO', () => {
  it('hands the window to the repository as instants', async () => {
    const repo: AiCampaignRepository = { totals: jest.fn().mockResolvedValue({ campaigns: 1, sent: 1, failed: 0, skipped: 0, other: 0 }) };
    const c = new AiCampaignController(new AiCampaignService(repo));
    await expect(c.totals({ from: FROM.toISOString(), to: TO.toISOString() })).resolves.toMatchObject({ campaigns: 1 });
    expect(repo.totals).toHaveBeenCalledWith(FROM, TO);
  });

  it('accepts real instants in order and refuses everything else', async () => {
    const check = (b: unknown) => validate(plainToInstance(AiCampaignWindowDto, b));
    expect(await check({ from: FROM.toISOString(), to: TO.toISOString() })).toHaveLength(0);
    expect((await check({ from: TO.toISOString(), to: FROM.toISOString() })).length).toBeGreaterThan(0);
    expect((await check({ from: '2026-02-30T00:00:00Z', to: TO.toISOString() })).length).toBeGreaterThan(0);
    expect((await check({ from: FROM.toISOString(), to: '2028-01-01T00:00:00Z' })).length).toBeGreaterThan(0);
  });
});
