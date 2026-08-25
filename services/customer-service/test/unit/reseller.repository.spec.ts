import { ResellerPrismaRepository } from '../../src/infrastructure/prisma/reseller.prisma.repository';
import { Reseller } from '../../src/application/ports/reseller.repository';

const row: Reseller = {
  customerId: 'c1',
  homeDepotId: 'd1',
  monthlyTargetQty: 100,
  discountPct: 0,
  flatGallonPriceIdr: 0,
  photoUrl: null,
  active: true,
  joinDate: new Date('2026-01-01'),
  note: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

/** K4.2: `field` comes back from Postgres as TEXT; the repo narrows it. */
const change = {
  id: 'ch-1',
  customerId: 'c1',
  changedBy: 'staff-1',
  field: 'discountPct',
  oldValue: '10',
  newValue: '5',
  effectiveAt: new Date('2026-09-01'),
  appliedAt: null as Date | null,
  createdAt: new Date('2026-08-25'),
};

function prismaMock() {
  return {
    resellerProfile: {
      findMany: jest.fn().mockResolvedValue([row]),
      findUnique: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
    },
    resellerPriceChange: {
      create: jest.fn().mockResolvedValue({ ...change }),
      findMany: jest.fn().mockResolvedValue([{ ...change }]),
      update: jest.fn().mockResolvedValue({ ...change }),
    },
  };
}

describe('ResellerPrismaRepository', () => {
  it('list applies both homeDepotId and active filters when provided', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    await repo.list({ homeDepotIds: ['d1'], active: true });
    expect(prisma.resellerProfile.findMany).toHaveBeenCalledWith({
      where: { homeDepotId: { in: ['d1'] }, active: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('list omits both filters when absent (empty where)', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    await repo.list({});
    expect(prisma.resellerProfile.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
    });
  });

  it('list keeps active:false (distinguished from unset)', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    await repo.list({ active: false });
    expect(prisma.resellerProfile.findMany).toHaveBeenCalledWith({
      where: { active: false },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findById reads by primary key', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    await repo.findById('c1');
    expect(prisma.resellerProfile.findUnique).toHaveBeenCalledWith({ where: { customerId: 'c1' } });
  });

  it('create defaults a missing note to null', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    await repo.create({
      customerId: 'c1',
      homeDepotId: 'd1',
      monthlyTargetQty: 100,
      joinDate: new Date('2026-01-01'),
    });
    expect(prisma.resellerProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: null, discountPct: 0 }),
    });
  });

  it('create passes a provided discountPct through', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    await repo.create({
      customerId: 'c1',
      homeDepotId: 'd1',
      monthlyTargetQty: 100,
      discountPct: 15,
      joinDate: new Date('2026-01-01'),
    });
    expect(prisma.resellerProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ discountPct: 15 }),
    });
  });

  it('create passes a provided note through', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    await repo.create({
      customerId: 'c1',
      homeDepotId: 'd1',
      monthlyTargetQty: 100,
      joinDate: new Date('2026-01-01'),
      note: 'grosir',
    });
    expect(prisma.resellerProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: 'grosir' }),
    });
  });

  it('update patches by primary key', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    await repo.update('c1', { monthlyTargetQty: 200 });
    expect(prisma.resellerProfile.update).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      data: { monthlyTargetQty: 200 },
    });
  });
});

describe('ResellerPrismaRepository price changes (K4.2)', () => {
  it('recordPriceChange appends a row and narrows the TEXT field', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);

    const out = await repo.recordPriceChange({
      customerId: 'c1',
      changedBy: 'staff-1',
      field: 'discountPct',
      oldValue: '10',
      newValue: '5',
      effectiveAt: new Date('2026-09-01'),
      appliedAt: null,
    });

    expect(prisma.resellerPriceChange.create).toHaveBeenCalledTimes(1);
    expect(out.field).toBe('discountPct');
  });

  it('listPriceChanges reads this agen newest first, bounded', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);

    await repo.listPriceChanges('c1', 50);

    expect(prisma.resellerPriceChange.findMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  // Oldest first matters: two changes to the same field must land in the order they were
  // scheduled, not in whichever order the page size happened to produce.
  it('findDuePriceChanges asks for unapplied changes whose moment has passed, oldest first', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    const now = new Date('2026-09-01T01:00:00.000Z');

    await repo.findDuePriceChanges(now, 500);

    expect(prisma.resellerPriceChange.findMany).toHaveBeenCalledWith({
      where: { appliedAt: null, effectiveAt: { lte: now } },
      orderBy: { effectiveAt: 'asc' },
      take: 500,
    });
  });

  it('markPriceChangeApplied stamps exactly the one row', async () => {
    const prisma = prismaMock();
    const repo = new ResellerPrismaRepository(prisma as never);
    const at = new Date('2026-09-01T01:00:00.000Z');

    await repo.markPriceChangeApplied('ch-1', at);

    expect(prisma.resellerPriceChange.update).toHaveBeenCalledWith({
      where: { id: 'ch-1' },
      data: { appliedAt: at },
    });
  });
});
