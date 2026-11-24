import { LegalEntityPrismaRepository } from '../../src/infrastructure/prisma/legal-entity.prisma.repository';
import { StaleWriteError } from '@hydromart/platform';

import { DuplicateLegalEntityNameError } from '../../src/domain/errors';

const NOW = new Date('2026-11-22T03:00:00.000Z');
const ROW = {
  id: 'e1',
  name: 'PT Kelola Air',
  kind: 'OPERATOR',
  active: true,
  createdBy: null,
  updatedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const POINT = {
  id: 'p1',
  depotId: 'd1',
  legalEntityId: 'e1',
  effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
  recordedBy: 'u1',
  recordedAt: NOW,
};

function setup() {
  const tx = {
    depotLegalEntity: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    legalEntity: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    legalEntityAiGrant: {
      createMany: jest.fn().mockReturnValue('createMany'),
      deleteMany: jest.fn().mockReturnValue('deleteMany'),
      findMany: jest.fn(),
    },
    depot: { findMany: jest.fn() },
    depotLegalEntity: { delete: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.resolve(arg),
    ),
  };
  return { prisma, tx, repo: new LegalEntityPrismaRepository(prisma as never) };
}

const uniqueViolation = Object.assign(new Error('unique'), { code: 'P2002' });
const missing = Object.assign(new Error('missing'), { code: 'P2025' });

describe('LegalEntityPrismaRepository', () => {
  it('lists entities by name with their granted roles', async () => {
    const { prisma, repo } = setup();
    prisma.legalEntity.findMany.mockResolvedValue([{ ...ROW, aiGrants: [{ roleKey: 'FINANCE' }] }]);
    expect(await repo.list()).toEqual([{ ...ROW, aiReadRoles: ['FINANCE'] }]);
    expect(prisma.legalEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 1000 }),
    );
  });

  it('finds one entity, or null', async () => {
    const { prisma, repo } = setup();
    prisma.legalEntity.findUnique.mockResolvedValueOnce(ROW).mockResolvedValueOnce(null);
    expect(await repo.findById('e1')).toEqual(ROW);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('answers which ids exist', async () => {
    const { prisma, repo } = setup();
    prisma.legalEntity.findMany.mockResolvedValue([{ id: 'e1' }]);
    expect(await repo.existingIds(['e1', 'e2'])).toEqual(['e1']);
  });

  it('turns the lower(name) unique index into 409 on create and rename, and rethrows the rest', async () => {
    const { prisma, repo } = setup();
    prisma.legalEntity.create.mockResolvedValueOnce(ROW).mockRejectedValueOnce(uniqueViolation);
    expect(await repo.create({ name: 'PT Kelola Air', kind: 'OPERATOR', createdBy: null })).toEqual(ROW);
    await expect(repo.create({ name: 'pt kelola air', kind: 'OPERATOR', createdBy: null })).rejects.toBeInstanceOf(
      DuplicateLegalEntityNameError,
    );
    const boom = new Error('db down');
    prisma.legalEntity.create.mockRejectedValueOnce(boom);
    await expect(repo.create({ name: 'X', kind: 'OPERATOR', createdBy: null })).rejects.toBe(boom);

    prisma.legalEntity.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(uniqueViolation)
      .mockRejectedValueOnce(boom);
    prisma.legalEntity.findUniqueOrThrow.mockResolvedValueOnce(ROW);
    expect(await repo.update('e1', { active: true, updatedBy: null }, NOW)).toEqual(ROW);
    expect(prisma.legalEntity.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', updatedAt: NOW },
      data: { active: true, updatedBy: null },
    });
    await expect(repo.update('e1', { name: 'X', updatedBy: null }, NOW)).rejects.toBeInstanceOf(
      DuplicateLegalEntityNameError,
    );
    await expect(repo.update('e1', { name: 'X', updatedBy: null }, NOW)).rejects.toBe(boom);
  });

  it('writes a bare toggle with no version to compare', async () => {
    const { prisma, repo } = setup();
    prisma.legalEntity.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.legalEntity.findUniqueOrThrow.mockResolvedValueOnce(ROW);
    await repo.update('e1', { active: false, updatedBy: null }, null);
    expect(prisma.legalEntity.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { active: false, updatedBy: null },
    });
  });

  it('refuses a rename whose version moved after the check (compare-and-set)', async () => {
    const { prisma, repo } = setup();
    prisma.legalEntity.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.update('e1', { name: 'X', updatedBy: null }, NOW)).rejects.toBeInstanceOf(StaleWriteError);
    expect(prisma.legalEntity.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('writes grants and revokes in one transaction, and nothing when there are neither', async () => {
    const { prisma, repo } = setup();
    await repo.setAiGrants(
      [
        { legalEntityId: 'e2', roleKey: 'HEAD_OFFICE', granted: true },
        { legalEntityId: 'e1', roleKey: 'HR', granted: false },
        { legalEntityId: 'e1', roleKey: 'FINANCE', granted: true },
      ],
      'u1',
    );
    // In one order for every writer (entity, then role), whatever order the request had.
    expect(prisma.legalEntityAiGrant.createMany).toHaveBeenCalledWith({
      data: [
        { legalEntityId: 'e1', roleKey: 'FINANCE', grantedBy: 'u1' },
        { legalEntityId: 'e2', roleKey: 'HEAD_OFFICE', grantedBy: 'u1' },
      ],
      skipDuplicates: true,
    });
    expect(prisma.legalEntityAiGrant.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ legalEntityId: 'e1', roleKey: 'HR' }] },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['createMany', 'deleteMany']);

    prisma.$transaction.mockClear();
    await repo.setAiGrants([{ legalEntityId: 'e1', roleKey: 'HR', granted: false }], 'u1');
    expect(prisma.$transaction).toHaveBeenCalledWith(['deleteMany']);
    prisma.$transaction.mockClear();
    await repo.setAiGrants([], 'u1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reads every depot with its points as calendar days', async () => {
    const { prisma, repo } = setup();
    prisma.depot.findMany.mockResolvedValue([
      { id: 'd1', code: 'JKT-01', name: 'Cikini', ownershipType: 'HKP', active: true, legalEntities: [POINT] },
    ]);
    expect(await repo.depotHistories()).toEqual([
      {
        depotId: 'd1',
        code: 'JKT-01',
        name: 'Cikini',
        ownershipType: 'HKP',
        active: true,
        points: [{ ...POINT, effectiveFrom: '2026-12-01' }],
      },
    ]);
  });

  it('locks each depot-day in order, checks what the screen saw, then upserts in one statement', async () => {
    const { repo, tx } = setup();
    tx.depotLegalEntity.findMany.mockResolvedValue([{ depotId: 'd1', legalEntityId: 'old' }]);
    tx.$queryRaw.mockResolvedValue([{ depotId: 'd1' }, { depotId: 'd2' }]);
    const written = await repo.assignDepots({
      depotIds: ['d2', 'd1'],
      legalEntityId: 'e1',
      effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
      recordedBy: null,
      seen: new Map([['d1', 'old']]),
    });
    expect(written).toEqual([
      { depotId: 'd1', replaced: 'old' },
      { depotId: 'd2', replaced: null },
    ]);
    const lock = tx.$executeRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
    expect(lock.strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(lock.values).toEqual(['depot-legal-entity:d1:2026-12-01', 'depot-legal-entity:d2:2026-12-01']);
    const sql = tx.$queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
    expect(sql.strings.join('?')).toContain('ON CONFLICT ("depotId", "effectiveFrom") DO UPDATE');
    expect(sql.values).toEqual(['e1', '2026-12-01', null, 'd1', 'd2']);
  });

  it('lets a day that already holds the target through, whatever the screen saw', async () => {
    const { repo, tx } = setup();
    tx.depotLegalEntity.findMany.mockResolvedValue([{ depotId: 'd1', legalEntityId: 'e1' }]);
    tx.$queryRaw.mockResolvedValue([]);
    const written = await repo.assignDepots({
      depotIds: ['d1'],
      legalEntityId: 'e1',
      effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
      recordedBy: null,
      seen: new Map(),
    });
    expect(written).toEqual([]);
  });

  it('refuses when a day holds something the screen did not show, and writes nothing', async () => {
    const { repo, tx } = setup();
    tx.depotLegalEntity.findMany.mockResolvedValue([{ depotId: 'd1', legalEntityId: 'theirs' }]);
    const base = {
      depotIds: ['d1'],
      legalEntityId: 'e1',
      effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
      recordedBy: null,
    };
    await expect(repo.assignDepots({ ...base, seen: new Map() })).rejects.toBeInstanceOf(StaleWriteError);
    await expect(repo.assignDepots({ ...base, seen: new Map([['d1', 'mine']]) })).rejects.toBeInstanceOf(
      StaleWriteError,
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('deletes one point, null when it is gone, and rethrows anything else', async () => {
    const { prisma, repo } = setup();
    prisma.depotLegalEntity.delete
      .mockResolvedValueOnce(POINT)
      .mockRejectedValueOnce(missing)
      .mockRejectedValueOnce(missing)
      .mockRejectedValueOnce(new Error('db down'));
    prisma.depotLegalEntity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p1' });
    expect(await repo.removeDepotPoint('p1', 'e1')).toEqual({ ...POINT, effectiveFrom: '2026-12-01' });
    expect(prisma.depotLegalEntity.delete).toHaveBeenCalledWith({ where: { id: 'p1', legalEntityId: 'e1' } });
    // Not deleted and gone: 404. Not deleted but still there: corrected since, refused.
    expect(await repo.removeDepotPoint('p1', 'e1')).toBeNull();
    await expect(repo.removeDepotPoint('p1', 'e1')).rejects.toBeInstanceOf(StaleWriteError);
    await expect(repo.removeDepotPoint('p1', 'e1')).rejects.toThrow('db down');
  });

  it('shapes the points up to the last day into spans, in calendar days', async () => {
    const { prisma, repo } = setup();
    prisma.depotLegalEntity.findMany.mockResolvedValue([
      { ...POINT, effectiveFrom: new Date('2026-01-01T00:00:00.000Z') },
      { ...POINT, id: 'p2', legalEntityId: 'e2', effectiveFrom: new Date('2026-11-16T00:00:00.000Z') },
    ]);
    const last = new Date('2026-11-30T00:00:00.000Z');
    const spans = await repo.entityTimeline(['d1'], new Date('2026-11-01T00:00:00.000Z'), last);
    expect(spans).toEqual([
      { depotId: 'd1', legalEntityId: 'e1', from: '2026-11-01' },
      { depotId: 'd1', legalEntityId: 'e2', from: '2026-11-16' },
    ]);
    expect(prisma.depotLegalEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { depotId: { in: ['d1'] }, effectiveFrom: { lte: last } } }),
    );
  });

  it('reads the entity ids a role key is granted', async () => {
    const { prisma, repo } = setup();
    prisma.legalEntityAiGrant.findMany.mockResolvedValue([{ legalEntityId: 'e1' }, { legalEntityId: 'e2' }]);
    expect(await repo.grantedEntityIds('FINANCE')).toEqual(['e1', 'e2']);
    expect(prisma.legalEntityAiGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { roleKey: 'FINANCE' } }),
    );
  });

  it('refuses, instead of cutting a history short, when the read hits its row cap', async () => {
    const { prisma, repo } = setup();
    prisma.depotLegalEntity.findMany.mockResolvedValue(Array.from({ length: 10_000 }, () => POINT));
    const day = new Date('2026-11-01T00:00:00.000Z');
    await expect(repo.entityTimeline(['d1'], day, day)).rejects.toThrow('read cap');
    expect(prisma.depotLegalEntity.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10_000 }));
  });

  it('refuses when a role has as many grants as the read cap', async () => {
    const { prisma, repo } = setup();
    prisma.legalEntityAiGrant.findMany.mockResolvedValue(Array.from({ length: 1000 }, () => ({ legalEntityId: 'e1' })));
    await expect(repo.grantedEntityIds('FINANCE')).rejects.toThrow('read cap');
  });
});
