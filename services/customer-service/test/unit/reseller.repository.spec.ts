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

function prismaMock() {
  return {
    resellerProfile: {
      findMany: jest.fn().mockResolvedValue([row]),
      findUnique: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
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
