import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AddressPrismaRepository } from '../../src/infrastructure/prisma/address.prisma.repository';
import { DepotCrmPrismaRepository } from '../../src/infrastructure/prisma/depot-crm.prisma.repository';
import { FavoritePrismaRepository } from '../../src/infrastructure/prisma/favorite.prisma.repository';
import { NotificationPrismaRepository } from '../../src/infrastructure/prisma/notification.prisma.repository';
import { PaymentMethodPrismaRepository } from '../../src/infrastructure/prisma/payment-method.prisma.repository';
import { ProfilePrismaRepository } from '../../src/infrastructure/prisma/profile.prisma.repository';
import { MembershipTier } from '../../src/domain/membership-tier.enum';

// Unit-tests the Prisma repositories against a per-model jest.fn() mock of PrismaService.
// No real database, no testcontainers: each test asserts the EXACT prisma call args and the
// row->record mapping. Mirrors services/auth-service/test/unit/prisma-repositories.spec.ts.

describe('AddressPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  };
  const $transaction = jest.fn().mockResolvedValue([]);
  const prisma = { address: model, $transaction } as unknown as PrismaService;
  const repo = new AddressPrismaRepository(prisma);
  const row = { id: 'addr-1', customerId: 'cust-1', isPrimary: true };

  beforeEach(() => jest.clearAllMocks());

  it('lists addresses primary-first, newest-first', async () => {
    model.findMany.mockResolvedValue([row]);
    const out = await repo.listByCustomer('cust-1');
    expect(out).toEqual([row]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('finds one scoped to the customer', async () => {
    model.findFirst.mockResolvedValue(row);
    await repo.findByIdForCustomer('cust-1', 'addr-1');
    expect(model.findFirst).toHaveBeenCalledWith({ where: { id: 'addr-1', customerId: 'cust-1' } });
  });

  it('returns null when the scoped lookup misses', async () => {
    model.findFirst.mockResolvedValue(null);
    expect(await repo.findByIdForCustomer('cust-1', 'nope')).toBeNull();
  });

  it('counts by customer', async () => {
    model.count.mockResolvedValue(3);
    expect(await repo.countByCustomer('cust-1')).toBe(3);
    expect(model.count).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
  });

  it('creates from raw data', async () => {
    model.create.mockResolvedValue(row);
    const data = { customerId: 'cust-1', label: 'Home' } as never;
    await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data });
  });

  it('updates by id ignoring the customer scope arg', async () => {
    model.update.mockResolvedValue(row);
    const patch = { label: 'Office' } as never;
    await repo.update('cust-1', 'addr-1', patch);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'addr-1' }, data: patch });
  });

  it('unsets the current primary flag', async () => {
    await repo.unsetPrimary('cust-1');
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', isPrimary: true },
      data: { isPrimary: false },
    });
  });

  it('marks a specific address primary', async () => {
    await repo.markPrimary('cust-1', 'addr-1');
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'addr-1', customerId: 'cust-1' },
      data: { isPrimary: true },
    });
  });

  it('sets primary exclusively in one transaction (clear-all then set-one)', async () => {
    model.updateMany.mockReturnValue('clear-then-set' as never);
    await repo.setPrimaryExclusive('cust-1', 'addr-1');
    expect($transaction).toHaveBeenCalledTimes(1);
    // both updateMany calls are built and handed to $transaction
    expect(model.updateMany).toHaveBeenNthCalledWith(1, {
      where: { customerId: 'cust-1', isPrimary: true },
      data: { isPrimary: false },
    });
    expect(model.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'addr-1', customerId: 'cust-1' },
      data: { isPrimary: true },
    });
    expect($transaction).toHaveBeenCalledWith(['clear-then-set', 'clear-then-set']);
  });

  it('deletes scoped to the customer', async () => {
    await repo.delete('cust-1', 'addr-1');
    expect(model.deleteMany).toHaveBeenCalledWith({ where: { id: 'addr-1', customerId: 'cust-1' } });
  });

  it('finds the most recent address, optionally excluding one', async () => {
    model.findFirst.mockResolvedValue(row);
    await repo.findMostRecent('cust-1');
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.findMostRecent('cust-1', 'addr-1');
    expect(model.findFirst).toHaveBeenLastCalledWith({
      where: { customerId: 'cust-1', id: { not: 'addr-1' } },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('PaymentMethodPrismaRepository', () => {
  const model = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  };
  const $transaction = jest.fn().mockResolvedValue([]);
  const prisma = { savedPaymentMethod: model, $transaction } as unknown as PrismaService;
  const repo = new PaymentMethodPrismaRepository(prisma);
  const row = { id: 'pm-1', customerId: 'cust-1', isDefault: true };

  beforeEach(() => jest.clearAllMocks());

  it('lists default-first, newest-first', async () => {
    model.findMany.mockResolvedValue([row]);
    expect(await repo.listByCustomer('cust-1')).toEqual([row]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('finds one scoped to the customer, null on miss', async () => {
    model.findFirst.mockResolvedValue(null);
    expect(await repo.findByIdForCustomer('cust-1', 'x')).toBeNull();
    expect(model.findFirst).toHaveBeenCalledWith({ where: { id: 'x', customerId: 'cust-1' } });
  });

  it('creates from raw data', async () => {
    model.create.mockResolvedValue(row);
    const data = { customerId: 'cust-1', type: 'CARD' } as never;
    await repo.create(data);
    expect(model.create).toHaveBeenCalledWith({ data });
  });

  it('updates by id ignoring the customer scope arg', async () => {
    model.update.mockResolvedValue(row);
    const patch = { label: 'Visa' } as never;
    await repo.update('cust-1', 'pm-1', patch);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'pm-1' }, data: patch });
  });

  it('unsets the current default flag', async () => {
    await repo.unsetDefault('cust-1');
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', isDefault: true },
      data: { isDefault: false },
    });
  });

  it('marks a specific method default', async () => {
    await repo.markDefault('cust-1', 'pm-1');
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'pm-1', customerId: 'cust-1' },
      data: { isDefault: true },
    });
  });

  it('sets default exclusively in one transaction (exactly-one-default invariant)', async () => {
    model.updateMany.mockReturnValue('op' as never);
    await repo.setDefaultExclusive('cust-1', 'pm-1');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(model.updateMany).toHaveBeenNthCalledWith(1, {
      where: { customerId: 'cust-1', isDefault: true },
      data: { isDefault: false },
    });
    expect(model.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'pm-1', customerId: 'cust-1' },
      data: { isDefault: true },
    });
    expect($transaction).toHaveBeenCalledWith(['op', 'op']);
  });

  it('deletes scoped to the customer', async () => {
    await repo.delete('cust-1', 'pm-1');
    expect(model.deleteMany).toHaveBeenCalledWith({ where: { id: 'pm-1', customerId: 'cust-1' } });
  });

  it('finds the most recent method with and without exclusion', async () => {
    model.findFirst.mockResolvedValue(row);
    await repo.findMostRecent('cust-1');
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
    });
    await repo.findMostRecent('cust-1', 'pm-1');
    expect(model.findFirst).toHaveBeenLastCalledWith({
      where: { customerId: 'cust-1', id: { not: 'pm-1' } },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('FavoritePrismaRepository', () => {
  const model = { findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() };
  const prisma = { favorite: model } as unknown as PrismaService;
  const repo = new FavoritePrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('lists product ids newest-first, mapping rows to ids', async () => {
    model.findMany.mockResolvedValue([{ productId: 'p-2' }, { productId: 'p-1' }]);
    expect(await repo.listProductIds('cust-1')).toEqual(['p-2', 'p-1']);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      orderBy: { createdAt: 'desc' },
      select: { productId: true },
    });
  });

  it('returns an empty array when there are no favorites', async () => {
    model.findMany.mockResolvedValue([]);
    expect(await repo.listProductIds('cust-1')).toEqual([]);
  });

  it('adds idempotently with skipDuplicates', async () => {
    await repo.add('cust-1', 'p-1');
    expect(model.createMany).toHaveBeenCalledWith({
      data: [{ customerId: 'cust-1', productId: 'p-1' }],
      skipDuplicates: true,
    });
  });

  it('removes by (customerId, productId)', async () => {
    await repo.remove('cust-1', 'p-1');
    expect(model.deleteMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', productId: 'p-1' },
    });
  });
});

describe('NotificationPrismaRepository', () => {
  const model = { findUnique: jest.fn(), upsert: jest.fn() };
  const prisma = { notificationPreference: model } as unknown as PrismaService;
  const repo = new NotificationPrismaRepository(prisma);
  const record = {
    customerId: 'cust-1',
    push: true,
    email: false,
    whatsapp: true,
    categories: { orders: true },
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns null when no preference row exists', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findByCustomerId('cust-1')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
  });

  it('maps a found row, preserving object categories', async () => {
    model.findUnique.mockResolvedValue(record);
    expect(await repo.findByCustomerId('cust-1')).toEqual(record);
  });

  it('coerces non-object categories to an empty object', async () => {
    model.findUnique.mockResolvedValue({ ...record, categories: null });
    const out = await repo.findByCustomerId('cust-1');
    expect(out?.categories).toEqual({});

    model.findUnique.mockResolvedValue({ ...record, categories: 'nope' });
    const out2 = await repo.findByCustomerId('cust-1');
    expect(out2?.categories).toEqual({});
  });

  it('upserts with create+update payloads and maps the result', async () => {
    model.upsert.mockResolvedValue(record);
    const out = await repo.upsert(record);
    expect(out).toEqual(record);
    expect(model.upsert).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      create: {
        customerId: 'cust-1',
        push: true,
        email: false,
        whatsapp: true,
        categories: { orders: true },
      },
      update: { push: true, email: false, whatsapp: true, categories: { orders: true } },
    });
  });
});

describe('ProfilePrismaRepository', () => {
  const model = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() };
  const $queryRaw = jest.fn();
  const prisma = { customerProfile: model, $queryRaw } as unknown as PrismaService;
  const repo = new ProfilePrismaRepository(prisma);
  const row = {
    customerId: 'cust-1',
    membershipTier: 'GOLD',
    pointBalance: 100,
    favoriteDepotId: 'depot-1',
    birthdate: new Date('2000-05-10'),
    lastBirthdayRewardYear: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns null when no profile exists', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findByCustomerId('cust-1')).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { customerId: 'cust-1' } });
  });

  it('maps the membershipTier string to the enum on find', async () => {
    model.findUnique.mockResolvedValue(row);
    const out = await repo.findByCustomerId('cust-1');
    expect(out?.membershipTier).toBe(MembershipTier.GOLD);
    expect(out?.pointBalance).toBe(100);
  });

  it('creates a bare profile and maps the tier', async () => {
    model.create.mockResolvedValue(row);
    const out = await repo.create('cust-1');
    expect(model.create).toHaveBeenCalledWith({ data: { customerId: 'cust-1' } });
    expect(out.membershipTier).toBe(MembershipTier.GOLD);
  });

  it('updates the favorite depot (set and clear)', async () => {
    model.update.mockResolvedValue(row);
    await repo.updateFavoriteDepot('cust-1', 'depot-9');
    expect(model.update).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      data: { favoriteDepotId: 'depot-9' },
    });
    await repo.updateFavoriteDepot('cust-1', null);
    expect(model.update).toHaveBeenLastCalledWith({
      where: { customerId: 'cust-1' },
      data: { favoriteDepotId: null },
    });
  });

  it('updates the birthdate', async () => {
    model.update.mockResolvedValue(row);
    const d = new Date('2000-05-10');
    await repo.updateBirthdate('cust-1', d);
    expect(model.update).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      data: { birthdate: d },
    });
  });

  it('finds birthday candidates via raw SQL, mapping to ids', async () => {
    $queryRaw.mockResolvedValue([{ customerId: 'cust-1' }, { customerId: 'cust-2' }]);
    expect(await repo.findBirthdayCandidates(5, 10, 2026)).toEqual(['cust-1', 'cust-2']);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('marks a customer birthday-rewarded for a year', async () => {
    model.update.mockResolvedValue(row);
    await repo.markBirthdayRewarded('cust-1', 2026);
    expect(model.update).toHaveBeenCalledWith({
      where: { customerId: 'cust-1' },
      data: { lastBirthdayRewardYear: 2026 },
    });
  });

  it('finds a segment with filters applied', async () => {
    $queryRaw.mockResolvedValue([{ customerId: 'cust-1', name: 'Budi', phone: '+62800' }]);
    const out = await repo.findSegment({ tier: MembershipTier.GOLD, city: 'Jakarta' });
    expect(out).toHaveLength(1);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('finds a segment with null filters (short-circuit path)', async () => {
    $queryRaw.mockResolvedValue([]);
    expect(await repo.findSegment({})).toEqual([]);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('DepotCrmPrismaRepository', () => {
  const $queryRaw = jest.fn();
  const prisma = { $queryRaw } as unknown as PrismaService;
  const repo = new DepotCrmPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('lists depot customers without a search term, mapping the tier', async () => {
    $queryRaw.mockResolvedValue([
      { customerId: 'cust-1', fullName: 'Budi', phone: '+62800', membershipTier: 'SILVER' },
    ]);
    const out = await repo.listDepotCustomers('depot-1');
    expect(out[0].membershipTier).toBe(MembershipTier.SILVER);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('lists depot customers with a trimmed search term', async () => {
    $queryRaw.mockResolvedValue([]);
    expect(await repo.listDepotCustomers('depot-1', '  budi  ')).toEqual([]);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('treats a blank search term as no filter', async () => {
    $queryRaw.mockResolvedValue([]);
    await repo.listDepotCustomers('depot-1', '   ');
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('finds customer ids by depot, mapping rows to ids', async () => {
    $queryRaw.mockResolvedValue([{ customerId: 'cust-1' }, { customerId: 'cust-2' }]);
    expect(await repo.findIdsByDepot('depot-1')).toEqual(['cust-1', 'cust-2']);
  });
});
