import { PdpPrismaRepository } from '../../src/infrastructure/prisma/pdp.prisma.repository';

describe('PdpPrismaRepository (UU PDP tahap 1)', () => {
  const customerProfile = { findUnique: jest.fn(), updateMany: jest.fn() };
  const address = { findMany: jest.fn(), updateMany: jest.fn() };
  const savedPaymentMethod = { findMany: jest.fn(), deleteMany: jest.fn() };
  const favorite = { findMany: jest.fn(), deleteMany: jest.fn() };
  const notificationPreference = { findUnique: jest.fn(), deleteMany: jest.fn() };
  const resellerProfile = { findFirst: jest.fn(), updateMany: jest.fn() };
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

  // CUS-05: the row stays (it is a primary-address join target) but nothing that locates a
  // person survives. The street, coordinates and postcode went on staying here for as long as
  // the database did, justified by "orders are kept 10 years", which is true of order-service's
  // own snapshot and not of this table.
  it('overwrites address PII and the location, keeping only the city', async () => {
    await repo.anonymise('c1');

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(address.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      data: {
        recipientName: 'Pengguna dihapus',
        phone: '-',
        notes: null,
        label: '-',
        addressLine: '-',
        postalCode: null,
        latitude: null,
        longitude: null,
      },
    });
    expect(address.findMany).not.toHaveBeenCalled();
  });

  it('clears the birthday promo inputs and drops the non-financial rows', async () => {
    await repo.anonymise('c1');

    expect(customerProfile.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      data: {
        birthdate: null,
        lastBirthdayRewardYear: null,
        // CUS-05: out of every depot's directory, and the marker the audience queries read.
        favoriteDepotId: null,
        anonymisedAt: expect.any(Date),
      },
    });
    expect(savedPaymentMethod.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c1' } });
    expect(favorite.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c1' } });
    expect(notificationPreference.deleteMany).toHaveBeenCalledWith({ where: { customerId: 'c1' } });
  });

  /*
   * The miss `docs/AUDIT_L3.md` §4.2 named most precisely: one file, two methods, one table.
   * `exportFor` above already reads `reseller_profiles` AS PERSONAL DATA — it is in the
   * export payload — and `anonymise` never touched it. It holds the agen's registration
   * photo (a KTP or a shopfront) and a free-text note.
   *
   * Deactivated rather than deleted: reseller pricing at checkout and the per-depot
   * achievement evaluation both read this row, so removing it would strand them. Delete the
   * `resellerProfile.updateMany` call and this test fails.
   */
  it('scrubs and deactivates the reseller profile the export already treats as personal', async () => {
    await repo.anonymise('c1');

    expect(resellerProfile.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      data: { photoUrl: null, note: null, active: false },
    });
  });
});
