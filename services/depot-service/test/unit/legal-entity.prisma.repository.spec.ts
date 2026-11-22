import { LegalEntityPrismaRepository } from '../../src/infrastructure/prisma/legal-entity.prisma.repository';
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
  };
  const prisma = {
    legalEntity: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    legalEntityAiGrant: {
      createMany: jest.fn().mockReturnValue('createMany'),
      deleteMany: jest.fn().mockReturnValue('deleteMany'),
    },
    depot: { findMany: jest.fn() },
    depotLegalEntity: { delete: jest.fn() },
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

    prisma.legalEntity.update.mockResolvedValueOnce(ROW).mockRejectedValueOnce(uniqueViolation).mockRejectedValueOnce(boom);
    expect(await repo.update('e1', { active: true, updatedBy: null })).toEqual(ROW);
    await expect(repo.update('e1', { name: 'X', updatedBy: null })).rejects.toBeInstanceOf(DuplicateLegalEntityNameError);
    await expect(repo.update('e1', { name: 'X', updatedBy: null })).rejects.toBe(boom);
  });

  it('writes grants and revokes in one transaction, and nothing when there are neither', async () => {
    const { prisma, repo } = setup();
    await repo.setAiGrants(
      [
        { legalEntityId: 'e1', roleKey: 'FINANCE', granted: true },
        { legalEntityId: 'e1', roleKey: 'HR', granted: false },
      ],
      'u1',
    );
    expect(prisma.legalEntityAiGrant.createMany).toHaveBeenCalledWith({
      data: [{ legalEntityId: 'e1', roleKey: 'FINANCE', grantedBy: 'u1' }],
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

  it('upserts the points in one statement and names what a corrected day held', async () => {
    const { repo, tx } = setup();
    tx.depotLegalEntity.findMany.mockResolvedValue([{ depotId: 'd1', legalEntityId: 'old' }]);
    tx.$queryRaw.mockResolvedValue([{ depotId: 'd1' }, { depotId: 'd2' }]);
    const written = await repo.assignDepots({
      depotIds: ['d1', 'd2'],
      legalEntityId: 'e1',
      effectiveFrom: new Date('2026-12-01T00:00:00.000Z'),
      recordedBy: null,
    });
    expect(written).toEqual([
      { depotId: 'd1', replaced: 'old' },
      { depotId: 'd2', replaced: null },
    ]);
    const sql = tx.$queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
    expect(sql.strings.join('?')).toContain('ON CONFLICT ("depotId", "effectiveFrom") DO UPDATE');
    expect(sql.values).toEqual(expect.arrayContaining(['e1', '2026-12-01', null, 'd1', 'd2']));
  });

  it('deletes one point, null when it is gone, and rethrows anything else', async () => {
    const { prisma, repo } = setup();
    prisma.depotLegalEntity.delete
      .mockResolvedValueOnce(POINT)
      .mockRejectedValueOnce(missing)
      .mockRejectedValueOnce(new Error('db down'));
    expect(await repo.removeDepotPoint('p1')).toEqual({ ...POINT, effectiveFrom: '2026-12-01' });
    expect(await repo.removeDepotPoint('p1')).toBeNull();
    await expect(repo.removeDepotPoint('p1')).rejects.toThrow('db down');
  });
});
