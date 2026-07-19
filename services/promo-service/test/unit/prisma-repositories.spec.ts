import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PromotionPrismaRepository } from '../../src/infrastructure/prisma/promotion.prisma.repository';
import { VoucherPrismaRepository } from '../../src/infrastructure/prisma/voucher.prisma.repository';
import { VoucherRequestPrismaRepository } from '../../src/infrastructure/prisma/voucher-request.prisma.repository';
import { DiscountType } from '../../src/domain/voucher';
import { VoucherRequestStatus } from '../../src/domain/voucher-request';

describe('PromotionPrismaRepository', () => {
  const model = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  };
  const prisma = { promotion: model } as unknown as PrismaService;
  const repo = new PromotionPrismaRepository(prisma);
  const row = { id: 'promo-1', title: 'Diskon', active: true };
  const ORDER_BY = [{ sortOrder: 'asc' }, { createdAt: 'desc' }];

  beforeEach(() => jest.clearAllMocks());

  it('findById returns the row', async () => {
    model.findUnique.mockResolvedValue(row);
    expect(await repo.findById('promo-1')).toBe(row);
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'promo-1' } });
  });

  it('findById returns null when absent', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('create passes data through', async () => {
    model.create.mockResolvedValue(row);
    const data = { title: 'Diskon', active: true } as never;
    expect(await repo.create(data)).toBe(row);
    expect(model.create).toHaveBeenCalledWith({ data });
  });

  it('update targets the id with the patch', async () => {
    model.update.mockResolvedValue(row);
    const data = { title: 'Baru' } as never;
    expect(await repo.update('promo-1', data)).toBe(row);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'promo-1' }, data });
  });

  it('delete removes by id and resolves void', async () => {
    model.delete.mockResolvedValue(row);
    expect(await repo.delete('promo-1')).toBeUndefined();
    expect(model.delete).toHaveBeenCalledWith({ where: { id: 'promo-1' } });
  });

  it('findAll orders by sortOrder then createdAt', async () => {
    model.findMany.mockResolvedValue([row]);
    expect(await repo.findAll()).toEqual([row]);
    expect(model.findMany).toHaveBeenCalledWith({ orderBy: ORDER_BY });
  });

  it('findActive applies the live-at filter', async () => {
    model.findMany.mockResolvedValue([row]);
    const now = new Date('2026-07-19T00:00:00Z');
    expect(await repo.findActive(now)).toEqual([row]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: ORDER_BY,
    });
  });
});

describe('VoucherPrismaRepository', () => {
  const voucher = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const voucherRedemption = {
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  };
  const voucherGrant = { findUnique: jest.fn(), create: jest.fn() };
  const $transaction = jest.fn();
  const prisma = { voucher, voucherRedemption, voucherGrant, $transaction } as unknown as PrismaService;
  const repo = new VoucherPrismaRepository(prisma);

  const voucherRow = () => ({
    id: 'v-1',
    code: 'HEMAT10',
    description: null,
    discountType: 'PERCENTAGE',
    value: 10,
    minSpend: 0,
    maxDiscount: null,
    validFrom: null,
    validUntil: null,
    usageLimit: null,
    perCustomerLimit: 1,
    budgetCap: null,
    usedCount: 0,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('findById maps the row and casts the discountType', async () => {
    voucher.findUnique.mockResolvedValue(voucherRow());
    const rec = await repo.findById('v-1');
    expect(rec?.discountType).toBe(DiscountType.PERCENTAGE);
    expect(voucher.findUnique).toHaveBeenCalledWith({ where: { id: 'v-1' } });
  });

  it('findById returns null when absent', async () => {
    voucher.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('findByCode looks up by code', async () => {
    voucher.findUnique.mockResolvedValue(voucherRow());
    const rec = await repo.findByCode('HEMAT10');
    expect(rec?.code).toBe('HEMAT10');
    expect(voucher.findUnique).toHaveBeenCalledWith({ where: { code: 'HEMAT10' } });
  });

  it('findByCode returns null when absent', async () => {
    voucher.findUnique.mockResolvedValue(null);
    expect(await repo.findByCode('nope')).toBeNull();
  });

  it('create writes the generated enum and maps back', async () => {
    voucher.create.mockResolvedValue(voucherRow());
    const rec = await repo.create({ code: 'HEMAT10', discountType: DiscountType.PERCENTAGE, value: 10 } as never);
    expect(rec.discountType).toBe(DiscountType.PERCENTAGE);
    expect(voucher.create).toHaveBeenCalledWith({
      data: { code: 'HEMAT10', discountType: 'PERCENTAGE', value: 10 },
    });
  });

  it('update maps the patch and result', async () => {
    voucher.update.mockResolvedValue(voucherRow());
    const rec = await repo.update('v-1', { value: 20 } as never);
    expect(rec.value).toBe(10);
    expect(voucher.update).toHaveBeenCalledWith({
      where: { id: 'v-1' },
      data: { value: 20, discountType: undefined },
    });
  });

  it('search paginates and returns items + total (activeOnly)', async () => {
    $transaction.mockResolvedValue([[voucherRow()], 1]);
    const res = await repo.search(2, 5, true);
    expect(res.total).toBe(1);
    expect(res.items[0].discountType).toBe(DiscountType.PERCENTAGE);
    expect(voucher.findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 5,
    });
    expect(voucher.count).toHaveBeenCalledWith({ where: { active: true } });
  });

  it('search with activeOnly false uses an empty where', async () => {
    $transaction.mockResolvedValue([[], 0]);
    const res = await repo.search(1, 10, false);
    expect(res).toEqual({ items: [], total: 0 });
    expect(voucher.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 10,
    });
  });

  it('countRedemptions scopes by voucher and optionally customer', async () => {
    voucherRedemption.count.mockResolvedValue(3);
    expect(await repo.countRedemptions('v-1', 'c-1')).toBe(3);
    expect(voucherRedemption.count).toHaveBeenCalledWith({ where: { voucherId: 'v-1', customerId: 'c-1' } });
    await repo.countRedemptions('v-1');
    expect(voucherRedemption.count).toHaveBeenLastCalledWith({ where: { voucherId: 'v-1' } });
  });

  it('sumRedemptionsFor returns the aggregate sum, 0 when null', async () => {
    voucherRedemption.aggregate.mockResolvedValue({ _sum: { discountApplied: 5000 } });
    expect(await repo.sumRedemptionsFor('v-1')).toBe(5000);
    voucherRedemption.aggregate.mockResolvedValue({ _sum: { discountApplied: null } });
    expect(await repo.sumRedemptionsFor('v-1')).toBe(0);
  });

  it('sumRedemptionsByVoucher maps groups, 0 when null', async () => {
    voucherRedemption.groupBy.mockResolvedValue([
      { voucherId: 'v-1', _sum: { discountApplied: 700 } },
      { voucherId: 'v-2', _sum: { discountApplied: null } },
    ]);
    expect(await repo.sumRedemptionsByVoucher()).toEqual([
      { voucherId: 'v-1', burned: 700 },
      { voucherId: 'v-2', burned: 0 },
    ]);
  });

  it('listForCustomer tallies redemptions in memory', async () => {
    $transaction.mockResolvedValue([
      [voucherRow(), { ...voucherRow(), id: 'v-2' }],
      [{ voucherId: 'v-1' }, { voucherId: 'v-1' }],
    ]);
    const res = await repo.listForCustomer('c-1');
    expect(res).toEqual([
      { voucher: expect.objectContaining({ id: 'v-1' }), customerRedemptions: 2 },
      { voucher: expect.objectContaining({ id: 'v-2' }), customerRedemptions: 0 },
    ]);
  });

  it('findRedemptionByOrder maps or returns null', async () => {
    const red = { id: 'r-1', orderId: 'o-1' };
    voucherRedemption.findUnique.mockResolvedValue(red);
    expect(await repo.findRedemptionByOrder('o-1')).toEqual(red);
    expect(voucherRedemption.findUnique).toHaveBeenCalledWith({ where: { orderId: 'o-1' } });
    voucherRedemption.findUnique.mockResolvedValue(null);
    expect(await repo.findRedemptionByOrder('o-2')).toBeNull();
  });

  it('recordRedemption creates the redemption and increments usedCount', async () => {
    const red = { id: 'r-1', voucherId: 'v-1' };
    $transaction.mockResolvedValue([red, voucherRow()]);
    const m = {
      voucherId: 'v-1',
      voucherCode: 'HEMAT10',
      customerId: 'c-1',
      orderId: 'o-1',
      discountApplied: 1000,
    };
    expect(await repo.recordRedemption(m)).toEqual(red);
    expect(voucherRedemption.create).toHaveBeenCalledWith({ data: m });
    expect(voucher.update).toHaveBeenCalledWith({
      where: { id: 'v-1' },
      data: { usedCount: { increment: 1 } },
    });
  });

  it('grantVoucher returns false when a grant already exists', async () => {
    voucherGrant.findUnique.mockResolvedValue({ voucherId: 'v-1', customerId: 'c-1' });
    expect(await repo.grantVoucher('v-1', 'c-1')).toBe(false);
    expect(voucherGrant.create).not.toHaveBeenCalled();
  });

  it('grantVoucher creates and returns true when none exists', async () => {
    voucherGrant.findUnique.mockResolvedValue(null);
    expect(await repo.grantVoucher('v-1', 'c-1')).toBe(true);
    expect(voucherGrant.create).toHaveBeenCalledWith({ data: { voucherId: 'v-1', customerId: 'c-1' } });
  });
});

describe('VoucherRequestPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { voucherRequest: model } as unknown as PrismaService;
  const repo = new VoucherRequestPrismaRepository(prisma);

  const requestRow = () => ({
    id: 'req-1',
    depotId: 'd-1',
    depotName: 'Depot Satu',
    code: 'DEPOT10',
    description: null,
    discountType: 'PERCENTAGE',
    value: 10,
    minSpend: 0,
    maxDiscount: null,
    usageLimit: null,
    perCustomerLimit: 1,
    note: null,
    status: 'PENDING',
    requestedBy: 'mgr-1',
    decidedBy: null,
    createdVoucherId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('create maps the persisted row to a record', async () => {
    model.create.mockResolvedValue(requestRow());
    const data = { depotId: 'd-1', code: 'DEPOT10' } as never;
    const rec = await repo.create(data);
    expect(rec.discountType).toBe(DiscountType.PERCENTAGE);
    expect(rec.status).toBe(VoucherRequestStatus.PENDING);
    expect(model.create).toHaveBeenCalledWith({ data });
  });

  it('list filters by status, paginates, and maps items', async () => {
    model.findMany.mockResolvedValue([requestRow()]);
    model.count.mockResolvedValue(1);
    const res = await repo.list({ status: VoucherRequestStatus.PENDING, page: 2, limit: 5 });
    expect(res.total).toBe(1);
    expect(res.items[0].id).toBe('req-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { status: VoucherRequestStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 5,
    });
    expect(model.count).toHaveBeenCalledWith({ where: { status: VoucherRequestStatus.PENDING } });
  });

  it('list without a status uses an empty where', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    const res = await repo.list({ page: 1, limit: 10 } as never);
    expect(res).toEqual({ items: [], total: 0 });
    expect(model.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 10,
    });
  });

  it('findById maps or returns null', async () => {
    model.findUnique.mockResolvedValue(requestRow());
    expect((await repo.findById('req-1'))?.id).toBe('req-1');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'req-1' } });
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('update applies only the provided fields', async () => {
    model.update.mockResolvedValue({
      ...requestRow(),
      status: 'APPROVED',
      decidedBy: 'hq-1',
      createdVoucherId: 'v-9',
    });
    const rec = await repo.update('req-1', {
      status: VoucherRequestStatus.APPROVED,
      decidedBy: 'hq-1',
      createdVoucherId: 'v-9',
    });
    expect(rec.status).toBe(VoucherRequestStatus.APPROVED);
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: VoucherRequestStatus.APPROVED, decidedBy: 'hq-1', createdVoucherId: 'v-9' },
    });
  });

  it('update omits fields that are undefined', async () => {
    model.update.mockResolvedValue(requestRow());
    await repo.update('req-1', {});
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: {},
    });
  });
});
