import { PaymentPrismaRepository } from '../../src/infrastructure/prisma/payment.prisma.repository';
import { PaymentAlreadyExistsError } from '../../src/domain/errors';
import { PaymentMethod } from '../../src/domain/payment';

// Audit DB-1: the repository must translate the partial-unique-index violation
// (P2002 — the DB guard against a concurrent double-initiate) into the same
// PaymentAlreadyExistsError the service's pre-check raises.
describe('PaymentPrismaRepository.create — active-payment unique-index race', () => {
  const data = {
    orderId: '11111111-1111-4111-8111-111111111111',
    customerId: '22222222-2222-4222-8222-222222222222',
    method: PaymentMethod.CASH,
    amount: 18000,
    reference: null,
    instruction: null,
    gatewayData: null,
  };

  it('translates a P2002 unique violation to PaymentAlreadyExistsError', async () => {
    const prisma = {
      payment: {
        create: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
      },
    };
    const repo = new PaymentPrismaRepository(prisma as never);
    await expect(repo.create(data)).rejects.toBeInstanceOf(PaymentAlreadyExistsError);
  });

  it('rethrows non-unique errors unchanged', async () => {
    const boom = Object.assign(new Error('db down'), { code: 'P1001' });
    const prisma = { payment: { create: jest.fn().mockRejectedValue(boom) } };
    const repo = new PaymentPrismaRepository(prisma as never);
    await expect(repo.create(data)).rejects.toBe(boom);
  });
});

// B-9: the refund write used to match on `id` alone, so two concurrent refunds both
// updated and both had already called the gateway. `updateIfStatus` is the compare-and-set
// that makes exactly one caller the refunder.
describe('PaymentPrismaRepository.updateIfStatus — refund claim', () => {
  const row = {
    id: 'pay-1',
    orderId: '11111111-1111-4111-8111-111111111111',
    customerId: '22222222-2222-4222-8222-222222222222',
    method: PaymentMethod.CASH,
    amount: { toNumber: () => 18000 },
    status: 'REFUNDED',
    reference: null,
    instruction: null,
    gatewayData: null,
    refundedAt: new Date(),
    refundReason: null,
    refundedAmount: { toNumber: () => 18000 },
    refundApproval: 'NONE',
    paidAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('carries the status predicate into the write, not just the id', async () => {
    const payment = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(row),
    };
    const repo = new PaymentPrismaRepository({ payment } as never);

    const result = await repo.updateIfStatus('pay-1', ['PAID'] as never, { status: 'REFUNDED' } as never);

    expect(payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay-1', status: { in: ['PAID'] } },
      data: { status: 'REFUNDED' },
    });
    expect(result?.id).toBe('pay-1');
  });

  it('returns null when another caller already moved the row', async () => {
    const payment = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
    };
    const repo = new PaymentPrismaRepository({ payment } as never);

    expect(
      await repo.updateIfStatus('pay-1', ['PAID'] as never, { status: 'REFUNDED' } as never),
    ).toBeNull();
    // Losing the claim must not even re-read: there is nothing this caller may act on.
    expect(payment.findUnique).not.toHaveBeenCalled();
  });

  it('returns null if the row vanished between the claim and the read', async () => {
    const payment = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(null),
    };
    const repo = new PaymentPrismaRepository({ payment } as never);

    expect(
      await repo.updateIfStatus('pay-1', ['PAID'] as never, { status: 'REFUNDED' } as never),
    ).toBeNull();
  });
});
