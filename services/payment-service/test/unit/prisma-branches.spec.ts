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
    model.groupBy.mockResolvedValue([{ method: 'QRIS', _sum: { amount: null }, _count: { _all: 0 } }]);
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
    const connect = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined as never);
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined as never);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
