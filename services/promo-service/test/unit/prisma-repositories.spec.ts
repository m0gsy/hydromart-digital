import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PromotionPrismaRepository } from '../../src/infrastructure/prisma/promotion.prisma.repository';
import { VoucherPrismaRepository } from '../../src/infrastructure/prisma/voucher.prisma.repository';
import { DiscountType } from '../../src/domain/voucher';
import { VoucherNotFoundError } from '../../src/domain/errors';

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
  const $queryRaw = jest.fn();
  const prisma = {
    voucher,
    voucherRedemption,
    voucherGrant,
    $transaction,
    $queryRaw,
  } as unknown as PrismaService;
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
    const rec = await repo.create({
      code: 'HEMAT10',
      discountType: DiscountType.PERCENTAGE,
      value: 10,
    } as never);
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

  // Audit S-14: every analytics number comes back aggregated. The console used to read a
  // voucher's whole redemption history and make five passes over it here.
  it('aggregates redemptions in SQL', async () => {
    voucherRedemption.aggregate.mockResolvedValue({
      _count: { _all: 5 },
      _sum: { discountApplied: 1900 },
    });
    voucherRedemption.count.mockResolvedValue(4);
    voucherRedemption.groupBy.mockResolvedValue([
      { customerId: 'c-1', _count: { _all: 2 }, _sum: { discountApplied: 900 } },
      { customerId: 'c-2', _count: { _all: 1 }, _sum: { discountApplied: null } },
    ]);
    $queryRaw
      .mockResolvedValueOnce([{ day: '2026-07-16', uses: 1n }])
      .mockResolvedValueOnce([{ orderId: 'o-1' }, { orderId: 'o-2' }]);

    const from = new Date('2026-07-16T00:00:00Z');
    const to = new Date('2026-07-23T00:00:00Z');
    const out = await repo.redemptionAnalytics('v-1', from, to, 10, 'Asia/Jakarta');

    expect(out).toEqual({
      totalUses: 5,
      totalSavingsIdr: 1900,
      usesInWindow: 4,
      dailyUses: [{ day: '2026-07-16', uses: 1 }],
      // A group with no sum reads as 0, never NaN.
      topCustomers: [
        { customerId: 'c-1', uses: 2, savingsIdr: 900 },
        { customerId: 'c-2', uses: 1, savingsIdr: 0 },
      ],
      orderIds: ['o-1', 'o-2'],
    });
    expect(voucherRedemption.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ _count: { customerId: 'desc' } }, { _sum: { discountApplied: 'desc' } }],
        take: 10,
      }),
    );
    // H-16: the day labels must be cut in the business zone. On UTC every redemption
    // before 07:00 WIB lands on the previous bar — and the caller labels its buckets
    // with local day keys, so a UTC label matches none of them and the chart reads zero.
    //
    // C2: and it takes TWO hops. `createdAt` is a naive timestamp holding UTC, so a single
    // `AT TIME ZONE 'Asia/Jakarta'` reads the stored value as though it were already local
    // and converts it the WRONG WAY — a 7-hour error in the opposite direction from the
    // one this assertion was written to catch. Label it UTC first, then read it locally.
    const dailySql = $queryRaw.mock.calls[0][0];
    expect(dailySql.strings.join('')).toContain(`AT TIME ZONE 'UTC' AT TIME ZONE `);
    expect(dailySql.values).toContain('Asia/Jakarta');
  });

  it('reports zero savings when nothing was ever redeemed', async () => {
    voucherRedemption.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { discountApplied: null },
    });
    voucherRedemption.count.mockResolvedValue(0);
    voucherRedemption.groupBy.mockResolvedValue([]);
    $queryRaw.mockResolvedValue([]);
    const out = await repo.redemptionAnalytics('v-1', new Date(0), new Date(1), 5, 'Asia/Jakarta');
    expect(out).toMatchObject({ totalUses: 0, totalSavingsIdr: 0, orderIds: [] });
  });

  it('countRedemptions scopes by voucher and optionally customer', async () => {
    voucherRedemption.count.mockResolvedValue(3);
    expect(await repo.countRedemptions('v-1', 'c-1')).toBe(3);
    expect(voucherRedemption.count).toHaveBeenCalledWith({
      where: { voucherId: 'v-1', customerId: 'c-1' },
    });
    await repo.countRedemptions('v-1');
    expect(voucherRedemption.count).toHaveBeenLastCalledWith({ where: { voucherId: 'v-1' } });
  });

  it('loads all authoritative redemption rows for one linked voucher in one query', async () => {
    const rows = [
      {
        id: 'r-1',
        voucherId: 'v-1',
        voucherCode: 'HEMAT10',
        customerId: 'c-1',
        orderId: 'o-1',
        discountApplied: 1000,
        createdAt: new Date('2026-07-22T00:00:00Z'),
      },
    ];
    voucherRedemption.findMany.mockResolvedValue(rows);

    const result = await (
      repo as unknown as { findRedemptionsFor(voucherId: string): Promise<typeof rows> }
    ).findRedemptionsFor('v-1');

    expect(result).toEqual(rows);
    expect(voucherRedemption.findMany).toHaveBeenCalledWith({
      where: { voucherId: 'v-1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
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

  /*
   * The lock serializes redemptions of one VOUCHER. It says nothing about one ORDER.
   *
   * `redeem` checks `findRedemptionByOrder` first, and that check is not the guard: a
   * retried checkout has both attempts read "not redeemed", both queue on the voucher
   * lock, and the second meet `@@unique([orderId])`. The rollback was already right —
   * nothing is double-burned. The answer was not: a raw P2002 is a 500 on a checkout that
   * succeeded, and the service says the right thing one line earlier for the same case
   * found one moment sooner.
   */
  it('answers a retried checkout with the redemption it already made', async () => {
    const red = { id: 'r-1', voucherId: 'v-1', orderId: 'o-1', discountApplied: 1000 };
    $transaction.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    voucherRedemption.findUnique.mockResolvedValue(red);

    const out = await repo.redeemAtomic(
      { voucherId: 'v-1', voucherCode: 'HEMAT10', customerId: 'c-1', orderId: 'o-1' },
      () => 1000,
    );

    expect(out.id).toBe('r-1');
    expect(voucherRedemption.findUnique).toHaveBeenCalledWith({ where: { orderId: 'o-1' } });
  });

  // A P2002 with nothing to read back is a DIFFERENT unique index, and reporting it as a
  // successful redemption would hand out a discount that was never recorded.
  it('rethrows a P2002 that is not this order', async () => {
    const dup = Object.assign(new Error('dup'), { code: 'P2002' });
    $transaction.mockRejectedValueOnce(dup);
    voucherRedemption.findUnique.mockResolvedValue(null);
    await expect(
      repo.redeemAtomic(
        { voucherId: 'v-1', voucherCode: 'HEMAT10', customerId: 'c-1', orderId: 'o-1' },
        () => 1000,
      ),
    ).rejects.toBe(dup);
  });

  /*
   * C4 · release. The voided-sale path: the redemption row goes and the counter comes back
   * down. Locked exactly the way `redeemAtomic` locks — the counter and the rows must move
   * together, or a concurrent redemption reads a count that disagrees with what is behind
   * it.
   */
  it('releaseAtomic deletes the redemption and decrements the counter under a lock', async () => {
    const red = { id: 'r-1', voucherId: 'v-1', orderId: 'o-9', discountApplied: 2_500 };
    const tx = {
      voucherRedemption: {
        findUnique: jest.fn().mockResolvedValue(red),
        delete: jest.fn().mockResolvedValue(red),
      },
      voucher: { update: jest.fn().mockResolvedValue(voucherRow()) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    $transaction.mockImplementationOnce(async (fn: (t: unknown) => unknown) => fn(tx));

    const out = await repo.releaseAtomic('o-9');

    expect(out?.id).toBe('r-1');
    // The row lock comes BEFORE the write, which is the whole point of doing it in here.
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.voucherRedemption.delete).toHaveBeenCalledWith({ where: { orderId: 'o-9' } });
    expect(tx.voucher.update).toHaveBeenCalledWith({
      where: { id: 'v-1' },
      data: { usedCount: { decrement: 1 } },
    });
  });

  it('releaseAtomic answers null for an order that redeemed nothing', async () => {
    const tx = {
      voucherRedemption: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() },
      voucher: { update: jest.fn() },
      $queryRaw: jest.fn(),
    };
    $transaction.mockImplementationOnce(async (fn: (t: unknown) => unknown) => fn(tx));

    // Idempotent: voiding a sale twice, or voiding one that never used a voucher, must not
    // drive somebody else's counter down.
    expect(await repo.releaseAtomic('o-none')).toBeNull();
    expect(tx.voucher.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('grantVoucher returns false when a grant already exists', async () => {
    voucherGrant.findUnique.mockResolvedValue({ voucherId: 'v-1', customerId: 'c-1' });
    expect(await repo.grantVoucher('v-1', 'c-1')).toBe(false);
    expect(voucherGrant.create).not.toHaveBeenCalled();
  });

  it('grantVoucher creates and returns true when none exists', async () => {
    voucherGrant.findUnique.mockResolvedValue(null);
    expect(await repo.grantVoucher('v-1', 'c-1')).toBe(true);
    expect(voucherGrant.create).toHaveBeenCalledWith({
      data: { voucherId: 'v-1', customerId: 'c-1' },
    });
  });
});
// H-1: the burn that the voucher caps actually rest on. The row is locked FOR UPDATE, the
// counts are read INSIDE that lock, and `decide` gets to reject before anything is
// written — so two customers spending the last use of a voucher cannot both win.
describe('VoucherPrismaRepository.redeemAtomic', () => {
  const tx = {
    $queryRaw: jest.fn(),
    voucherRedemption: { count: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
    voucher: { update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const repo = new VoucherPrismaRepository(prisma);
  const input = {
    voucherId: '11111111-1111-4111-8111-111111111111',
    voucherCode: 'HEMAT10',
    customerId: 'cust-1',
    orderId: 'ord-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ usedCount: 3 }]);
    tx.voucherRedemption.count.mockResolvedValue(1);
    tx.voucherRedemption.aggregate.mockResolvedValue({ _sum: { discountApplied: 5000 } });
    tx.voucherRedemption.create.mockResolvedValue({
      id: 'r-1',
      voucherId: input.voucherId,
      voucherCode: 'HEMAT10',
      customerId: 'cust-1',
      orderId: 'ord-1',
      discountApplied: 2000,
      createdAt: new Date('2026-08-03'),
    });
  });

  it('decides against the counts read under the lock, then burns', async () => {
    const seen: unknown[] = [];
    const out = await repo.redeemAtomic(input, (counts) => {
      seen.push(counts);
      return 2000;
    });

    expect(seen).toEqual([{ usedCount: 3, customerRedemptions: 1, burned: 5000 }]);
    expect(out).toMatchObject({ id: 'r-1', discountApplied: 2000 });
    // The counter moves by an increment, not an absolute read back from before the lock.
    expect(tx.voucher.update).toHaveBeenCalledWith({
      where: { id: input.voucherId },
      data: { usedCount: { increment: 1 } },
    });
  });

  it('treats a voucher that vanished under the lock as not found', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(repo.redeemAtomic(input, () => 2000)).rejects.toBeInstanceOf(VoucherNotFoundError);
    expect(tx.voucherRedemption.create).not.toHaveBeenCalled();
  });

  it('writes nothing when decide rejects the burn', async () => {
    const boom = new Error('usage limit reached');
    await expect(
      repo.redeemAtomic(input, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(tx.voucherRedemption.create).not.toHaveBeenCalled();
    expect(tx.voucher.update).not.toHaveBeenCalled();
  });

  it('reads a never-redeemed voucher as zero burned, not null', async () => {
    tx.voucherRedemption.aggregate.mockResolvedValue({ _sum: { discountApplied: null } });
    const seen: { burned: number }[] = [];
    await repo.redeemAtomic(input, (counts) => {
      seen.push(counts);
      return 2000;
    });
    expect(seen[0].burned).toBe(0);
  });
});

