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
