import { PaymentMethodPrismaRepository } from '../../src/infrastructure/prisma/payment-method.prisma.repository';
import { DefaultPaymentMethodConflictError } from '../../src/domain/errors';

// Audit DB-2 (create path): createExclusiveDefault runs unset+insert in one
// transaction. Two concurrent "add as default" collide on the partial unique index
// (saved_payment_methods_one_default_per_customer); the loser's P2002 must surface as
// a 409, not an unhandled Prisma 500 — mirrors the DB-1 regression test in
// payment-service (payment.repository.spec.ts).
describe('PaymentMethodPrismaRepository.createExclusiveDefault — one-default unique-index race', () => {
  const data = {
    customerId: '22222222-2222-4222-8222-222222222222',
    type: 'EWALLET' as const,
    label: 'GoPay',
    maskedIdentifier: '****4821',
    isDefault: true,
  };

  const prismaWith = (txResult: unknown) => ({
    savedPaymentMethod: { updateMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn().mockRejectedValue(txResult),
  });

  it('translates a P2002 unique violation to DefaultPaymentMethodConflictError', async () => {
    const repo = new PaymentMethodPrismaRepository(
      prismaWith(Object.assign(new Error('unique'), { code: 'P2002' })) as never,
    );
    await expect(repo.createExclusiveDefault(data)).rejects.toBeInstanceOf(
      DefaultPaymentMethodConflictError,
    );
  });

  it('rethrows non-unique errors unchanged', async () => {
    const boom = Object.assign(new Error('db down'), { code: 'P1001' });
    const repo = new PaymentMethodPrismaRepository(prismaWith(boom) as never);
    await expect(repo.createExclusiveDefault(data)).rejects.toBe(boom);
  });
});
