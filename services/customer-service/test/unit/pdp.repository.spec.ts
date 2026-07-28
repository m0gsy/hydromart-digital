import { PdpPrismaRepository } from '../../src/infrastructure/prisma/pdp.prisma.repository';

describe('PdpPrismaRepository (UU PDP tahap 1)', () => {
  const customerProfile = { findUnique: jest.fn(), updateMany: jest.fn() };
  const address = { findMany: jest.fn(), updateMany: jest.fn() };
  const savedPaymentMethod = { findMany: jest.fn(), deleteMany: jest.fn() };
  const favorite = { findMany: jest.fn(), deleteMany: jest.fn() };
  const notificationPreference = { findUnique: jest.fn(), deleteMany: jest.fn() };
  const resellerProfile = { findFirst: jest.fn() };
  const $transaction = jest.fn(async (ops: unknown) => ops);
  const repo = new PdpPrismaRepository({
    customerProfile,
    address,
    savedPaymentMethod,
    favorite,
    notificationPreference,
    resellerProfile,
    $transaction,
  } as never);

  beforeEach(() => jest.clearAllMocks());

  it('gathers every table this service holds for the customer', async () => {
    customerProfile.findUnique.mockResolvedValue({ customerId: 'c1' });
    address.findMany.mockResolvedValue([{ id: 'a1' }]);
    savedPaymentMethod.findMany.mockResolvedValue([]);
    favorite.findMany.mockResolvedValue([{ productId: 'p1' }]);
    notificationPreference.findUnique.mockResolvedValue(null);
    resellerProfile.findFirst.mockResolvedValue(null);

    const out = await repo.exportFor('c1');

    expect(out).toEqual({
      profile: { customerId: 'c1' },
      addresses: [{ id: 'a1' }],
      paymentMethods: [],
      favorites: [{ productId: 'p1' }],
      notifications: null,
      reseller: null,
    });
  });

  it('overwrites address PII instead of deleting the address itself', async () => {
    await repo.anonymise('c1');

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(address.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      data: { recipientName: 'Pengguna dihapus', phone: '-', notes: null },
    });
    // The order that was delivered there still needs a street (item 12 keeps it 10 years).
    expect(address.findMany).not.toHaveBeenCalled();
  });

  it('clears the birthday promo inputs and drops the non-financial rows', async () => {
    await repo.anonymise('c1');

    expect(customerProfile.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      data: { birthdate: null, lastBirthdayRewardYear: null },
    });
    expect(savedPaymentMethod.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c1' } });
    expect(favorite.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c1' } });
    expect(notificationPreference.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c1' } });
  });
});
