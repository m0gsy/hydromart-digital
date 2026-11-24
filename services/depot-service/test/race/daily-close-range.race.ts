import { randomUUID } from 'node:crypto';

import { addLocalDays, dayStartUtc } from '@hydromart/platform';

import { DailyClosePrismaRepository } from '../../src/infrastructure/prisma/daily-close.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 A1 finding 4: `depot_daily_closes.businessDate` is a Postgres DATE, but the month-close
 * and governance callers pass WIB-midnight INSTANTS (e.g. 2026-07-31T17:00Z for 1 Aug). This
 * pins what Prisma/Postgres really do when such an instant is compared with a DATE column,
 * at the boundaries a month close cares about.
 */
describeRace('daily-close range read against a DATE column', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: DailyClosePrismaRepository;
  let depotId: string;
  const tz = 'Asia/Jakarta';

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new DailyClosePrismaRepository(prisma as never);
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
    const base = {
      depotId,
      closedAt: new Date(),
      closedBy: randomUUID(),
      cashInIdr: 1,
      cashOutIdr: 0,
      konterIdr: 0,
      codDepositedIdr: 0,
      codExpectedIdr: 0,
    };
    // 31 Jul, 1 Aug, 31 Aug, 1 Sep — the edges of August.
    for (const d of ['2026-07-31', '2026-08-01', '2026-08-31', '2026-09-01']) {
      await prisma.depotDailyClose.create({ data: { ...base, businessDate: new Date(d) } });
    }
  });
  afterAll(async () => drop?.());

  it('PROOF of the bug: a WIB-midnight INSTANT against the DATE column shifts both ends', async () => {
    const from = dayStartUtc('2026-08-01', tz); // 2026-07-31T17:00Z
    const to = addLocalDays(from, 31, tz); // 2026-08-31T17:00Z
    const rows = await prisma.depotDailyClose.findMany({
      where: { depotId, businessDate: { gte: from, lt: to } },
      orderBy: { businessDate: 'asc' },
    });
    const days = rows.map((r) => r.businessDate.toISOString().slice(0, 10));
    expect(days).toContain('2026-07-31'); // last day of the PREVIOUS month leaks in
    expect(days).not.toContain('2026-08-31'); // this month's last day is lost
  });

  it('August as day keys returns exactly 1 Aug .. 31 Aug', async () => {
    const rows = await repo.listForDepotRange(depotId, '2026-08-01', '2026-09-01');
    expect(rows.map((r) => r.businessDate)).toEqual(['2026-08-01', '2026-08-31']);
  });

  it('a reopened day is not a closed day', async () => {
    await prisma.depotDailyClose.update({
      where: { depotId_businessDate: { depotId, businessDate: new Date('2026-08-01') } },
      data: { reopenedAt: new Date(), reopenedBy: randomUUID() },
    });
    const rows = await repo.listForDepotRange(depotId, '2026-08-01', '2026-09-01');
    expect(rows.map((r) => r.businessDate)).toEqual(['2026-08-31']);
  });
});
