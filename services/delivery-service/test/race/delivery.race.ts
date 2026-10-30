import { randomUUID } from 'node:crypto';

import { DeliveryStatus } from '../../src/domain/delivery-status';
import { DeliveryAlreadyExistsError, DriverBusyError } from '../../src/domain/errors';
import { DeliveryPrismaRepository } from '../../src/infrastructure/prisma/delivery.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('delivery writes on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: DeliveryPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new DeliveryPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const data = (driverId: string) => ({
    orderId: randomUUID(),
    orderNumber: `HM-${randomUUID()}`,
    driverId,
    depotId: null,
    destinationAddress: 'Jl. Merdeka 10',
    destinationLat: null,
    destinationLng: null,
    recipientPhone: null,
    customerId: null,
    items: null,
    codAmount: null,
    notes: null,
    deliveryWindow: null,
  });

  it('dispatchers racing for one courier: the cap holds, the rest are told the courier is busy', async () => {
    for (let i = 0; i < 10; i++) {
      const driverId = randomUUID();
      const res = await race(Array.from({ length: 4 }, () => () => repo.createIfUnderCap(data(driverId), 1)));
      const won = res.filter((r) => r.status === 'fulfilled');
      expect(won).toHaveLength(1);
      for (const r of res.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DriverBusyError);
      }
      expect(await repo.countActiveByDriver(driverId)).toBe(1);
    }
  });

  it('a higher cap lets exactly that many through', async () => {
    const driverId = randomUUID();
    const res = await race(Array.from({ length: 6 }, () => () => repo.createIfUnderCap(data(driverId), 3)));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  });

  it('two dispatchers re-opening the same RESCHEDULED row: one wins, the other conflicts', async () => {
    for (let i = 0; i < 10; i++) {
      const first = await repo.createIfUnderCap(data(randomUUID()), 1);
      await repo.applyStatus(first.id, DeliveryStatus.ASSIGNED, DeliveryStatus.RESCHEDULED, {}, null, null);
      const [a, b] = [randomUUID(), randomUUID()];
      const res = await race([
        () => repo.reassignIfUnderCap(first.id, a, randomUUID(), null, 1),
        () => repo.reassignIfUnderCap(first.id, b, randomUUID(), null, 1),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(DeliveryAlreadyExistsError);
      const row = (await repo.findById(first.id))!;
      expect([a, b]).toContain(row.driverId);
    }
  });

  it('Gagal racing Selesai: exactly one status write lands', async () => {
    for (let i = 0; i < 20; i++) {
      const d = await repo.createIfUnderCap(data(randomUUID()), 1);
      const res = await race([
        () => repo.applyStatus(d.id, DeliveryStatus.ASSIGNED, DeliveryStatus.FAILED, { failedAt: new Date() }, null, 'x'),
        () =>
          repo.completeWithProof(
            d.id,
            DeliveryStatus.ASSIGNED,
            {
              photoUrl: 'u',
              signatureUrl: null,
              sealIntact: true,
              recipientName: 'Budi',
              latitude: -6.2,
              longitude: 106.8,
              note: null,
            },
            'drv',
            new Date(),
          ),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }
  });
});
