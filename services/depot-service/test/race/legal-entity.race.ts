import { randomUUID } from 'node:crypto';

import { StaleWriteError } from '@hydromart/platform';

import { DuplicateLegalEntityNameError } from '../../src/domain/errors';
import { parseCalendarDay } from '../../src/domain/legal-entity';
import { LegalEntityPrismaRepository } from '../../src/infrastructure/prisma/legal-entity.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('legal entities on real Postgres (HD-5)', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: LegalEntityPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new LegalEntityPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const depot = () =>
    prisma.depot.create({
      data: {
        code: `D-${randomUUID().slice(0, 8)}`,
        name: 'Depot Cikini',
        ownershipType: 'HKP',
        address: 'Jl. Cikini Raya No. 1',
        city: 'Jakarta',
        province: 'DKI Jakarta',
        lat: -6.19,
        lng: 106.84,
        deliveryFee: 5000,
      },
    });

  it('twenty people adding one company in different cases: one row, the rest 409', async () => {
    const results = await race(
      Array.from({ length: 20 }, (_, i) => () =>
        repo.create({ name: i % 2 ? 'PT Kelola Air' : 'pt kelola air', kind: 'OPERATOR', createdBy: null }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused).toHaveLength(19);
    expect(refused.every((r) => r.reason instanceof DuplicateLegalEntityNameError)).toBe(true);
    expect(await prisma.legalEntity.count()).toBe(1);
  });

  it('twenty screens dating two depots on one day, in both orders: one lands, nineteen 409, no deadlock', async () => {
    const d = await depot();
    const e = await depot();
    const entities = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        repo.create({ name: `PT Mitra ${i} ${randomUUID().slice(0, 4)}`, kind: 'FRANCHISEE', createdBy: null }),
      ),
    );
    const day = parseCalendarDay('2026-12-01')!;
    // Every screen read both days empty; the order of the ids alternates, which is what would
    // deadlock two writers that locked in the order they were given.
    const results = await race(
      Array.from({ length: 20 }, (_, i) => () =>
        repo.assignDepots({
          depotIds: i % 2 ? [d.id, e.id] : [e.id, d.id],
          legalEntityId: entities[i % 4].id,
          effectiveFrom: day,
          recordedBy: null,
          seen: new Map(),
        }),
      ),
    );
    // Exactly one wrote. The rest either asked for what it wrote (a no-op) or are told the day
    // changed under them (409): none failed any other way, none wrote a second time.
    const kept = results.filter((r): r is PromiseFulfilledResult<unknown[]> => r.status === 'fulfilled');
    expect(kept.filter((r) => r.value.length > 0)).toHaveLength(1);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused.every((r) => r.reason instanceof StaleWriteError)).toBe(true);
    expect(refused.length).toBeGreaterThan(0);
    const rows = await prisma.depotLegalEntity.findMany({ where: { depotId: { in: [d.id, e.id] } } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.legalEntityId)).size).toBe(1);
    expect(entities.map((x) => x.id)).toContain(rows[0].legalEntityId);
    // The calendar day survives the round trip whatever the session time zone.
    const [history] = (await repo.depotHistories()).filter((h) => h.depotId === d.id);
    expect(history.points[0].effectiveFrom).toBe('2026-12-01');
  });

  it('two renames carrying the same version: the second is refused (updatedAt moves on updateMany)', async () => {
    const e = await repo.create({ name: `PT Cas ${randomUUID().slice(0, 4)}`, kind: 'OPERATOR', createdBy: null });
    await new Promise((r) => setTimeout(r, 5));
    const first = await repo.update(e.id, { name: `${e.name} A`, updatedBy: null }, e.updatedAt);
    expect(first.updatedAt.getTime()).toBeGreaterThan(e.updatedAt.getTime());
    await expect(repo.update(e.id, { name: `${e.name} B`, updatedBy: null }, e.updatedAt)).rejects.toBeInstanceOf(
      StaleWriteError,
    );
    expect((await repo.findById(e.id))?.name).toBe(`${e.name} A`);
  });

  it('two editors saving different matrix cells at once keep both', async () => {
    const e = await repo.create({ name: `PT Indo ${randomUUID().slice(0, 4)}`, kind: 'FRANCHISOR', createdBy: null });
    await repo.setAiGrants([{ legalEntityId: e.id, roleKey: 'HR', granted: true }], null);
    const results = await race([
      () => repo.setAiGrants([{ legalEntityId: e.id, roleKey: 'FINANCE', granted: true }], null),
      () => repo.setAiGrants([{ legalEntityId: e.id, roleKey: 'HEAD_OFFICE', granted: true }], null),
      () => repo.setAiGrants([{ legalEntityId: e.id, roleKey: 'HR', granted: false }], null),
      () => repo.setAiGrants([{ legalEntityId: e.id, roleKey: 'FINANCE', granted: true }], null),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const [record] = (await repo.list()).filter((x) => x.id === e.id);
    expect(record.aiReadRoles).toEqual(['FINANCE', 'HEAD_OFFICE']);
  });
});
