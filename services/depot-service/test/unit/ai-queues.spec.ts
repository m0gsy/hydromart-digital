import { AiQueuesRepository } from '../../src/application/ports/ai-queues.repository';
import { AiQueuesService } from '../../src/application/services/ai-queues.service';
import { AiQueuesPrismaRepository } from '../../src/infrastructure/prisma/ai-queues.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AiQueuesController } from '../../src/modules/ai-queues.controller';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-25T03:00:00Z');

describe('AiQueuesService (HD-6 A-01)', () => {
  it('answers one row per depot asked, with zeros for what is not open, sorted and de-duplicated', async () => {
    const repo: AiQueuesRepository = {
      openCounts: jest.fn().mockResolvedValue({
        incidents: new Map([[D2, 3]]),
        disputes: new Map([[D1, 1]]),
        approvals: new Map([[D1, 2]]),
        maintenanceOverdue: new Map(),
      }),
    };
    const rows = await new AiQueuesService(repo).open([D2, D1, D2], NOW);
    expect(repo.openCounts).toHaveBeenCalledWith([D1, D2], NOW);
    expect(rows).toEqual([
      { depotId: D1, incidents: 0, disputes: 1, approvals: 2, maintenanceOverdue: 0 },
      { depotId: D2, incidents: 3, disputes: 0, approvals: 0, maintenanceOverdue: 0 },
    ]);
  });

  it('defaults "now" to the present moment', async () => {
    const repo: AiQueuesRepository = {
      openCounts: jest.fn().mockResolvedValue({ incidents: new Map(), disputes: new Map(), approvals: new Map(), maintenanceOverdue: new Map() }),
    };
    await new AiQueuesService(repo).open([D1]);
    expect((repo.openCounts as jest.Mock).mock.calls[0][1]).toBeInstanceOf(Date);
  });
});

describe('AiQueuesPrismaRepository', () => {
  it('groups four open states by depot, the overdue date as "next service not after now"', async () => {
    const group = (rows: { depotId: string; n: number }[]) =>
      jest.fn().mockResolvedValue(rows.map((r) => ({ depotId: r.depotId, _count: { _all: r.n } })));
    const prisma = {
      incident: { groupBy: group([{ depotId: D1, n: 2 }]) },
      orderDispute: { groupBy: group([{ depotId: D2, n: 1 }]) },
      approval: { groupBy: group([]) },
      maintenanceItem: { groupBy: group([{ depotId: D1, n: 4 }]) },
    };
    const out = await new AiQueuesPrismaRepository(prisma as unknown as PrismaService).openCounts([D1, D2], NOW);
    expect(out.incidents.get(D1)).toBe(2);
    expect(out.disputes.get(D2)).toBe(1);
    expect(out.approvals.size).toBe(0);
    expect(out.maintenanceOverdue.get(D1)).toBe(4);
    expect(prisma.incident.groupBy.mock.calls[0][0].where).toEqual({ depotId: { in: [D1, D2] }, status: { not: 'RESOLVED' } });
    expect(prisma.orderDispute.groupBy.mock.calls[0][0].where.status).toBe('OPEN');
    expect(prisma.approval.groupBy.mock.calls[0][0].where.status).toEqual({ in: ['PENDING', 'HELD'] });
    expect(prisma.maintenanceItem.groupBy.mock.calls[0][0].where.nextDueAt).toEqual({ lt: NOW });
  });
});

describe('AiQueuesController', () => {
  it('wraps the rows in items and splits the depot list', async () => {
    const queues = { open: jest.fn().mockResolvedValue([{ depotId: D1 }]) };
    const out = await new AiQueuesController(queues as unknown as AiQueuesService).open({ depotIds: `${D1},${D2}` });
    expect(queues.open).toHaveBeenCalledWith([D1, D2]);
    expect(out).toEqual({ items: [{ depotId: D1 }] });
  });
});
