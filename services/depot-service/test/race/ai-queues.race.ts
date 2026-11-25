import { randomUUID } from 'node:crypto';

import { AiQueuesPrismaRepository } from '../../src/infrastructure/prisma/ai-queues.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H4 part 2 (A-01) against a real Postgres: what is open, depot by depot, now.
 */
describeRace('AI open queues against a real database', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AiQueuesPrismaRepository;
  const now = new Date('2026-11-25T03:00:00Z');

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AiQueuesPrismaRepository(prisma as never);
  });
  afterAll(async () => drop());

  const depot = (name: string) =>
    prisma.depot.create({
      data: { code: `D-${randomUUID().slice(0, 8)}`, name, ownershipType: 'HKP' as never, address: 'Jl. 1', city: 'Bandung', province: 'Jabar', lat: -6.9, lng: 107.6, deliveryFee: 5000 },
    });

  it('counts unresolved incidents, open disputes, pending approvals and overdue maintenance per depot', async () => {
    const a = await depot('A');
    const b = await depot('B');
    const incident = (depotId: string, status: string) =>
      prisma.incident.create({ data: { depotId, type: 'OTHER' as never, severity: 'LOW' as never, status: status as never, title: 't', reportedBy: randomUUID() } });
    await incident(a.id, 'OPEN');
    await incident(a.id, 'IN_PROGRESS');
    await incident(a.id, 'RESOLVED');
    await incident(b.id, 'RESOLVED');
    const dispute = (depotId: string, status: string) =>
      prisma.orderDispute.create({
        data: { depotId, orderRef: 'HM-1', customerName: 'x', category: 'OTHER' as never, description: 'd', status: status as never, raisedBy: randomUUID() },
      });
    await dispute(a.id, 'OPEN');
    await dispute(a.id, 'RESOLVED');
    await dispute(b.id, 'OPEN');
    const item = (depotId: string, nextDueAt: Date) =>
      prisma.maintenanceItem.create({
        data: { depotId, name: 'RO', category: 'Filter', intervalDays: 30, nextDueAt },
      });
    await item(a.id, new Date('2026-11-25T03:00:00Z')); // due exactly now: not overdue (strictly before now only)
    await item(a.id, new Date('2026-11-26T03:00:00Z'));
    await item(a.id, new Date('2026-11-25T02:59:59Z')); // a second earlier: overdue
    const approval = (depotId: string, status: string) =>
      prisma.approval.create({
        data: { depotId, type: 'OPNAME_VARIANCE' as never, status: status as never, title: 't', submittedBy: randomUUID(), amountIdr: 1000, autoPassThreshold: 0 },
      });
    await approval(a.id, 'PENDING');
    await approval(a.id, 'HELD');
    await approval(a.id, 'APPROVED');
    const out = await repo.openCounts([a.id, b.id], now);
    expect(out.incidents.get(a.id)).toBe(2);
    expect(out.incidents.get(b.id)).toBeUndefined();
    expect(out.disputes.get(a.id)).toBe(1);
    expect(out.disputes.get(b.id)).toBe(1);
    expect(out.maintenanceOverdue.get(a.id)).toBe(1); // only the one due before now
    expect(out.approvals.get(a.id)).toBe(2); // PENDING and HELD are open, APPROVED is not
    expect(out.approvals.get(b.id)).toBeUndefined();
  });
});
