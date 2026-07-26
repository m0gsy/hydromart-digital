import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { GallonIssuePrismaRepository } from '../../src/infrastructure/prisma/gallon-issue.prisma.repository';
import { GallonReturnPrismaRepository } from '../../src/infrastructure/prisma/gallon-return.prisma.repository';
import { IncidentPrismaRepository } from '../../src/infrastructure/prisma/incident.prisma.repository';
import { SubscriptionPrismaRepository } from '../../src/infrastructure/prisma/subscription.prisma.repository';
import { HandoverPrismaRepository } from '../../src/infrastructure/prisma/handover.prisma.repository';

// Covers the null-aggregate `?? 0` fallbacks and the not-found `row ? … : null` branches that
// only fire on empty data — the happy-path prisma-repositories.spec always has rows/sums.

describe('prisma repository null/empty branches', () => {
  it('falls back to 0 for null gallon-issue aggregates', async () => {
    const gallonIssue = {
      aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { quantity: null, depositHeld: null } }),
      groupBy: jest.fn().mockResolvedValue([{ depotId: 'd', _sum: { quantity: null, depositHeld: null } }]),
    };
    const repo = new GallonIssuePrismaRepository({ gallonIssue } as unknown as PrismaService);
    expect(await repo.summaryForDepot('d')).toEqual({ issues: 0, gallons: 0, depositHeld: 0 });
    expect(await repo.networkSummary()).toEqual([{ depotId: 'd', gallons: 0, depositHeld: 0 }]);
  });

  it('falls back to 0 for null gallon-return network aggregates', async () => {
    const gallonReturn = {
      groupBy: jest.fn().mockResolvedValue([{ depotId: 'd', _sum: { quantity: null, depositRefunded: null } }]),
    };
    const repo = new GallonReturnPrismaRepository({ gallonReturn } as unknown as PrismaService);
    expect(await repo.networkSummary()).toEqual([{ depotId: 'd', gallons: 0, depositRefunded: 0 }]);
  });

  it('returns null from incident findById when the row is missing', async () => {
    const incident = { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) };
    const repo = new IncidentPrismaRepository({ incident } as unknown as PrismaService);
    expect(await repo.findById('x')).toBeNull();
    await repo.listForDepot('d');
    await repo.listForDepot('d', 'OPEN' as never);
    expect(incident.findMany).toHaveBeenCalledTimes(2);
  });

  it('returns null from subscription findById when the row is missing', async () => {
    const subscription = { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) };
    const repo = new SubscriptionPrismaRepository({ subscription } as unknown as PrismaService);
    expect(await repo.findById('x')).toBeNull();
    await repo.listForDepot('d');
    await repo.listForDepot('d', 'ACTIVE' as never);
    expect(subscription.findMany).toHaveBeenCalledTimes(2);
  });

  it('returns null from handover findById when the row is missing', async () => {
    const shiftHandover = { findUnique: jest.fn().mockResolvedValue(null) };
    const repo = new HandoverPrismaRepository({ shiftHandover } as unknown as PrismaService);
    expect(await repo.findById('x')).toBeNull();
  });
});
