import { AddressPrismaRepository } from '../../src/infrastructure/prisma/address.prisma.repository';
import { PrimaryAddressConflictError } from '../../src/domain/errors';

// Audit DB-2 (create path): createExclusivePrimary runs unset+insert in one
// transaction. Two concurrent "add as primary" collide on the partial unique index
// (addresses_one_primary_per_customer); the loser's P2002 must surface as a 409
// PrimaryAddressConflictError, not an unhandled Prisma 500 — mirrors the DB-1
// regression test in payment-service (payment.repository.spec.ts).
describe('AddressPrismaRepository.createExclusivePrimary — one-primary unique-index race', () => {
  const data = {
    customerId: '22222222-2222-4222-8222-222222222222',
    label: 'Rumah',
    recipientName: 'Budi',
    phone: '081234567890',
    addressLine: 'Jl. Merdeka 10',
    city: 'Bandung',
    province: 'Jawa Barat',
    postalCode: null,
    latitude: null,
    longitude: null,
    notes: null,
    isPrimary: true,
  };

  // updateMany/create are called to build the $transaction array before it runs, so
  // they must exist; $transaction is what rejects.
  const prismaWith = (txResult: unknown) => ({
    address: { updateMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn().mockRejectedValue(txResult),
  });

  it('translates a P2002 unique violation to PrimaryAddressConflictError', async () => {
    const repo = new AddressPrismaRepository(
      prismaWith(Object.assign(new Error('unique'), { code: 'P2002' })) as never,
    );
    await expect(repo.createExclusivePrimary(data)).rejects.toBeInstanceOf(
      PrimaryAddressConflictError,
    );
  });

  it('rethrows non-unique errors unchanged', async () => {
    const boom = Object.assign(new Error('db down'), { code: 'P1001' });
    const repo = new AddressPrismaRepository(prismaWith(boom) as never);
    await expect(repo.createExclusivePrimary(data)).rejects.toBe(boom);
  });
});
