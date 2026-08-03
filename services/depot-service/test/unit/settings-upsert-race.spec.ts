import { SettingsPrismaRepository } from '../../src/infrastructure/prisma/settings.prisma.repository';

// H-11. service_settings had no unique key, so two admins saving the same setting both
// passed the "does it exist yet" read and both inserted. loadAll() then returned two rows
// for one key and whichever the scan happened to yield last won — a per-depot fee or rate
// flapping between two values with nothing in the UI to explain it. Migration
// 20260803160000_service_settings_unique adds the partial uniques; this pins the
// repository half, which turns the loser's rejected insert into an update.
describe('SettingsPrismaRepository upsert races (H-11)', () => {
  const P2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  const row = {
    scope: 'DEPOT' as const,
    depotId: 'depot-1',
    key: 'deliveryFee',
    value: '3000',
    updatedBy: 'u2',
  };

  const prismaWith = (createError: unknown) => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const create = jest.fn(async () => {
      throw createError;
    });
    return {
      updateMany,
      create,
      prisma: {
        serviceSetting: { findFirst: async () => null, create, update: jest.fn(), updateMany },
      } as never,
    };
  };

  it('applies its value on top when the insert loses to the partial unique index', async () => {
    const { prisma, updateMany, create } = prismaWith(P2002);
    await new SettingsPrismaRepository(prisma).upsert(row);

    expect(create).toHaveBeenCalledTimes(1);
    // No second row: the loser updates the winner's instead.
    expect(updateMany).toHaveBeenCalledWith({
      where: { scope: 'DEPOT', depotId: 'depot-1', key: 'deliveryFee' },
      data: { value: '3000', updatedBy: 'u2' },
    });
  });

  it('rethrows any other write failure rather than treating it as a race', async () => {
    const boom = Object.assign(new Error('down'), { code: 'P1001' });
    const { prisma, updateMany } = prismaWith(boom);
    await expect(new SettingsPrismaRepository(prisma).upsert(row)).rejects.toBe(boom);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
