import { randomUUID } from 'node:crypto';

import { AddressLimitError } from '../../src/domain/errors';
import { AddressPrismaRepository } from '../../src/infrastructure/prisma/address.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('customer addresses on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AddressPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AddressPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const data = (customerId: string) => ({
    customerId,
    label: 'Rumah',
    recipientName: 'Budi',
    phone: '0811',
    addressLine: 'Jl. Merdeka 10',
    city: 'Bandung',
    province: 'Jawa Barat',
    postalCode: null,
    latitude: null,
    longitude: null,
    notes: null,
  });
  const primaries = (customerId: string) =>
    prisma.address.count({ where: { customerId, isPrimary: true } });

  it('ten adds past a cap of 3: exactly 3 land, the rest are told the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const customerId = randomUUID();
      const res = await race(
        Array.from({ length: 10 }, () => () => repo.createWithinLimit(data(customerId), false, 3)),
      );
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      for (const r of res.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AddressLimitError);
      }
      expect(await prisma.address.count({ where: { customerId } })).toBe(3);
      expect(await primaries(customerId)).toBe(1);
    }
  });

  it('concurrent "add as primary": every one lands and exactly one is primary', async () => {
    const customerId = randomUUID();
    const res = await race(
      Array.from({ length: 6 }, () => () => repo.createWithinLimit(data(customerId), true, 10)),
    );
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await primaries(customerId)).toBe(1);
  });

  it('concurrent setPrimary on different addresses: one primary survives', async () => {
    const customerId = randomUUID();
    const made = [];
    for (let i = 0; i < 4; i++) made.push(await repo.createWithinLimit(data(customerId), false, 10));
    const res = await race(made.map((a) => () => repo.setPrimaryExclusive(customerId, a.id)));
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await primaries(customerId)).toBe(1);
  });

  it('deleting the primary while another add runs never leaves a customer with addresses and no primary', async () => {
    for (let i = 0; i < 10; i++) {
      const customerId = randomUUID();
      const first = await repo.createWithinLimit(data(customerId), false, 10);
      await repo.createWithinLimit(data(customerId), false, 10);
      await race([
        () => repo.removeAndPromote(customerId, first.id),
        () => repo.createWithinLimit(data(customerId), false, 10),
      ]);
      expect(await primaries(customerId)).toBe(1);
    }
  });
});
