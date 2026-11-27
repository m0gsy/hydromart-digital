import { randomUUID } from 'node:crypto';

import { UnservedDemandPrismaRepository } from '../../src/infrastructure/prisma/unserved-demand.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('unserved demand capture on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: UnservedDemandPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new UnservedDemandPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const address = (customerId: string, latitude: number) =>
    prisma.address.create({
      data: {
        customerId,
        label: 'Rumah',
        recipientName: 'Budi',
        phone: '0811',
        addressLine: 'Jl. Merdeka 10',
        city: 'Bandung',
        latitude,
        longitude: 107,
        kecamatanCode: '3273180',
      },
    });

  it('parallel saves of one customer in one kecamatan and month count one person', async () => {
    for (let i = 0; i < 5; i++) {
      const customerId = randomUUID();
      const monthKey = `2026-${String(i + 1).padStart(2, '0')}`;
      const made = await Promise.all([address(customerId, -6.9), address(customerId, -6.95), address(customerId, -7)]);
      const res = await race(
        made.map((a) => () =>
          repo.record(
            { monthKey, kecamatanCode: '3273180', kelurahanCode: null, gridCell: '1:2', distanceBand: '>10' },
            { customerId, addressId: a.id, latitude: a.latitude as number, longitude: a.longitude as number },
          ),
        ),
      );
      expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(res.filter((r) => (r as PromiseFulfilledResult<boolean>).value)).toHaveLength(1);
      expect(await prisma.unservedDemand.count({ where: { monthKey } })).toBe(1);
    }
  });
});
