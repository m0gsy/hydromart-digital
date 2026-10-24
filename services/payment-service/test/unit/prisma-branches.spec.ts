import { PaymentPrismaRepository } from '../../src/infrastructure/prisma/payment.prisma.repository';
import { PaymentMethod, PaymentStatus } from '../../src/domain/payment';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// Fills the remaining aggregate date-range branches (one-sided / empty windows,
// null sums) and the PrismaService connect/disconnect lifecycle.

describe('PaymentPrismaRepository aggregate range branches', () => {
  const model = { groupBy: jest.fn() };
  const prisma = { payment: model } as unknown as PrismaService;
  const repo = new PaymentPrismaRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    model.groupBy.mockResolvedValue([]);
  });

  it('aggregateUnsettledByMethod: from only → gte, no lte', async () => {
    const from = new Date('2026-01-01');
    await repo.aggregateUnsettledByMethod({ from });
    expect(model.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: PaymentStatus.PENDING, createdAt: { gte: from } },
      }),
    );
  });

  it('aggregateUnsettledByMethod: to only → lte, no gte', async () => {
    const to = new Date('2026-01-31');
    await repo.aggregateUnsettledByMethod({ to });
    expect(model.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: PaymentStatus.PENDING, createdAt: { lte: to } },
      }),
    );
  });

  it('aggregateRevenueByMethod: to only → lte, no gte', async () => {
    const to = new Date('2026-02-28');
    await repo.aggregateRevenueByMethod({ to });
    expect(model.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: PaymentStatus.PAID, createdAt: { lte: to } },
      }),
    );
  });

  it('aggregateRevenueByMethod: empty range omits createdAt and coerces null sums', async () => {
    model.groupBy.mockResolvedValue([
      { method: 'QRIS', _sum: { amount: null }, _count: { _all: 0 } },
    ]);
    const out = await repo.aggregateRevenueByMethod({});
    expect(model.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: PaymentStatus.PAID } }),
    );
    expect(out).toEqual([{ method: PaymentMethod.QRIS, amount: 0, count: 0 }]);
  });
});

describe('PrismaService lifecycle', () => {
  it('connects on module init and disconnects on destroy', async () => {
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined as never);
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined as never);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentPrismaRepository.aggregateUnsettledAging', () => {
  const queryRaw = jest.fn();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const repo = new PaymentPrismaRepository(prisma);
  const asOf = new Date('2026-10-15T05:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('asks the database to age only what is pending, in the business zone, against the given boundaries', async () => {
    queryRaw.mockResolvedValue([]);
    await repo.aggregateUnsettledAging(asOf, 'Asia/Jakarta', [1, 3, 7]);
    const q = queryRaw.mock.calls[0]![0] as { strings: string[]; values: unknown[] };
    const sql = q.strings.join('?');
    // Pending only, and the status is cast to its enum type.
    expect(sql).toContain('FROM "payments"');
    expect(sql).toContain('"status" = ');
    expect(sql).toContain('::"PaymentStatus"');
    // "createdAt" is a naive UTC timestamp: labelled UTC, then read in the zone.
    expect(sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE");
    expect(sql).toContain('GREATEST(');
    // Nothing is interpolated: the boundaries, the zone, the instant and the status are parameters.
    expect(q.values).toEqual(
      expect.arrayContaining([1, 3, 7, 'Asia/Jakarta', asOf, PaymentStatus.PENDING]),
    );
    expect(sql).not.toContain('Asia/Jakarta');
  });

  it('writes one WHEN per boundary and an ELSE for everything older', async () => {
    queryRaw.mockResolvedValue([]);
    await repo.aggregateUnsettledAging(asOf, 'Asia/Jakarta', [1, 3, 7]);
    const q = queryRaw.mock.calls[0]![0] as { strings: string[]; values: unknown[] };
    const sql = q.strings.join('?');
    expect(sql.match(/WHEN/g)).toHaveLength(3);
    // Bucket indexes 0,1,2 for the WHENs and 3 (the boundary count) for the ELSE.
    expect(q.values.filter((v) => v === 3).length).toBeGreaterThanOrEqual(2);
  });

  it('turns decimal sums and bigint counts into numbers', async () => {
    queryRaw.mockResolvedValue([
      { method: 'QRIS', bucket: 0, amount: { toString: () => '12500.50' }, count: BigInt(2) },
      { method: 'CASH', bucket: 3, amount: null, count: BigInt(1) },
    ]);
    expect(await repo.aggregateUnsettledAging(asOf, 'Asia/Jakarta', [1, 3, 7])).toEqual([
      { method: PaymentMethod.QRIS, bucket: 0, amount: 12500.5, count: 2 },
      { method: PaymentMethod.CASH, bucket: 3, amount: 0, count: 1 },
    ]);
  });
});
