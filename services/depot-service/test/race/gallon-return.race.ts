import { randomUUID } from 'node:crypto';

import { GallonReturnService } from '../../src/application/services/gallon-return.service';
import { GallonOverReturnError } from '../../src/domain/errors';
import { GallonCondition } from '../../src/domain/gallon-return';
import { GallonIssuePrismaRepository } from '../../src/infrastructure/prisma/gallon-issue.prisma.repository';
import { GallonReturnPrismaRepository } from '../../src/infrastructure/prisma/gallon-return.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

const DEPOSIT = 20_000;

describeRace('gallon returns on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let service: GallonReturnService;
  let depotId: string;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    const depot = await prisma.depot.create({
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
    });
    depotId = depot.id;
    service = new GallonReturnService(
      new GallonReturnPrismaRepository(prisma as never),
      new GallonIssuePrismaRepository(prisma as never),
      { exists: async () => true } as never,
      { gallonDepositIdr: () => DEPOSIT } as never,
      { create: async () => undefined } as never,
      { moveRawLine: async () => true } as never,
    );
  });
  afterAll(async () => drop?.());

  const customerWith = async (gallons: number) => {
    const customerId = randomUUID();
    await prisma.gallonIssue.create({
      data: { depotId, customerId, quantity: gallons, depositHeld: gallons * DEPOSIT, actorId: 'staff' } as never,
    });
    return customerId;
  };
  const refunded = async (customerId: string) =>
    Number(
      (await prisma.gallonReturn.aggregate({ where: { customerId }, _sum: { depositRefunded: true } }))._sum
        .depositRefunded ?? 0,
    );

  it('two counter returns for one deposit: it is refunded once, the other is refused', async () => {
    for (let i = 0; i < 10; i++) {
      const customerId = await customerWith(1);
      const res = await race([
        () => service.record(depotId, { quantity: 1, customerId, depositRefunded: DEPOSIT }, 'staff-1'),
        () => service.record(depotId, { quantity: 1, customerId, depositRefunded: DEPOSIT }, 'staff-2'),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        GallonOverReturnError,
      );
      expect(await refunded(customerId)).toBe(DEPOSIT);
    }
  });

  it('two courier handovers: together they never refund more than was held', async () => {
    for (let i = 0; i < 10; i++) {
      const customerId = await customerWith(1);
      await race([
        () =>
          service.recordFromCourier(
            depotId,
            { orderId: randomUUID(), quantity: 1, customerId, condition: GallonCondition.GOOD },
            'c1',
          ),
        () =>
          service.recordFromCourier(
            depotId,
            { orderId: randomUUID(), quantity: 1, customerId, condition: GallonCondition.GOOD },
            'c2',
          ),
      ]);
      expect(await refunded(customerId)).toBe(DEPOSIT);
    }
  });
});
