import { randomUUID } from 'node:crypto';

import { GallonIssueService } from '../../src/application/services/gallon-issue.service';
import { GallonReturnService } from '../../src/application/services/gallon-return.service';
import { GallonIssuePrismaRepository } from '../../src/infrastructure/prisma/gallon-issue.prisma.repository';
import { GallonReturnPrismaRepository } from '../../src/infrastructure/prisma/gallon-return.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

const DEPOSIT = 20_000;

// HD-6: a counter void reaches depot-service from an at-least-once outbox, and a sweep plus the
// inline re-send can overlap. N concurrent reversals of one booked refill must write ONE negative
// issue row and ONE negative return row, and put the shelf back exactly once.
describeRace('counter void reversal on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let issueSvc: GallonIssueService;
  let returnSvc: GallonReturnService;
  let depotId: string;
  let shelf = 0;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    depotId = (
      await prisma.depot.create({
        data: {
          code: `D-${randomUUID().slice(0, 8)}`,
          name: 'Depot',
          ownershipType: 'HKP' as never,
          address: 'Jl. 1',
          city: 'Bandung',
          province: 'Jabar',
          lat: -6.9,
          lng: 107.6,
          deliveryFee: 5000,
        },
      })
    ).id;
    const issues = new GallonIssuePrismaRepository(prisma as never);
    const depots = { exists: async () => true } as never;
    const config = { gallonDepositIdr: () => DEPOSIT } as never;
    const approvals = { create: async () => undefined, registerReversal: () => undefined } as never;
    // The shelf is a running sum of every movement, so "net 0" is measurable.
    const inventory = {
      moveRawLine: async (_d: string, _t: unknown, delta: number) => {
        shelf += delta;
        return { shortfall: 0 };
      },
    } as never;
    issueSvc = new GallonIssueService(issues, depots, config, inventory, approvals);
    returnSvc = new GallonReturnService(
      new GallonReturnPrismaRepository(prisma as never),
      issues,
      depots,
      config,
      approvals,
      inventory,
    );
  });
  afterAll(async () => drop?.());

  it('five concurrent reversals of one refill: one row per ledger, shelf net zero', async () => {
    for (let i = 0; i < 5; i++) {
      shelf = 0;
      const orderId = randomUUID();
      const customerId = randomUUID();
      await issueSvc.recordFromOrder(depotId, { orderId, customerId, quantity: 2 }, 'os');
      await returnSvc.recordFromCounter(depotId, { orderId, customerId, quantity: 2 }, 'os');
      expect(shelf).toBe(0); // out 2, back 2

      const res = await race(
        Array.from({ length: 5 }, () => () => returnSvc.reverseOrder(depotId, orderId, 'os')),
      );
      expect(res.every((r) => r.status === 'fulfilled')).toBe(true);

      const issueRows = await prisma.gallonIssue.findMany({ where: { depotId, customerId } });
      const returnRows = await prisma.gallonReturn.findMany({ where: { depotId, customerId } });
      expect(issueRows.filter((r) => r.quantity < 0)).toHaveLength(1);
      expect(returnRows.filter((r) => r.quantity < 0)).toHaveLength(1);
      expect(issueRows.reduce((s, r) => s + r.quantity, 0)).toBe(0);
      expect(returnRows.reduce((s, r) => s + r.quantity, 0)).toBe(0);
      // Reversal put back +2 (issue) and took off -2 (return): net unchanged from before the sale.
      expect(shelf).toBe(0);
    }
  });
});
