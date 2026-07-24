import { SettingsPrismaRepository } from '../../src/infrastructure/prisma/settings.prisma.repository';

describe('SettingsPrismaRepository', () => {
  it('loadAll maps rows to SettingRow shape', async () => {
    const prisma = {
      serviceSetting: {
        findMany: async () => [
          { scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '500' },
        ],
      },
    } as never;
    const repo = new SettingsPrismaRepository(prisma);
    await expect(repo.loadAll()).resolves.toEqual([
      { scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '500' },
    ]);
  });

  it('upsert creates a new row when none exists yet (global)', async () => {
    const calls: { op: string; arg: unknown }[] = [];
    const prisma = {
      serviceSetting: {
        findFirst: async (arg: unknown) => {
          calls.push({ op: 'findFirst', arg });
          return undefined;
        },
        create: async (arg: unknown) => {
          calls.push({ op: 'create', arg });
          return { id: 'x' };
        },
        update: async (arg: unknown) => {
          calls.push({ op: 'update', arg });
          return { id: 'x' };
        },
      },
    } as never;
    const repo = new SettingsPrismaRepository(prisma);
    await repo.upsert({ scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '600', updatedBy: 'u1' });

    expect(calls.map((c) => c.op)).toEqual(['findFirst', 'create']);
    expect(calls[0].arg).toEqual({
      where: { scope: 'GLOBAL', depotId: null, key: 'referrerPoints' },
      select: { id: true },
    });
    expect(calls[1].arg).toEqual({
      data: { scope: 'GLOBAL', depotId: null, key: 'referrerPoints', value: '600', updatedBy: 'u1' },
    });
  });

  it('upsert updates the existing row when one already exists', async () => {
    const calls: { op: string; arg: unknown }[] = [];
    const prisma = {
      serviceSetting: {
        findFirst: async (arg: unknown) => {
          calls.push({ op: 'findFirst', arg });
          return { id: 'existing-id' };
        },
        create: async (arg: unknown) => {
          calls.push({ op: 'create', arg });
          return { id: 'x' };
        },
        update: async (arg: unknown) => {
          calls.push({ op: 'update', arg });
          return { id: 'existing-id' };
        },
      },
    } as never;
    const repo = new SettingsPrismaRepository(prisma);
    await repo.upsert({ scope: 'GLOBAL', depotId: null, key: 'refereePoints', value: '300', updatedBy: 'u2' });

    expect(calls.map((c) => c.op)).toEqual(['findFirst', 'update']);
    expect(calls[1].arg).toEqual({
      where: { id: 'existing-id' },
      data: { value: '300', updatedBy: 'u2' },
    });
  });

  it('remove deletes matching rows', async () => {
    const calls: unknown[] = [];
    const prisma = {
      serviceSetting: {
        deleteMany: async (arg: unknown) => {
          calls.push(arg);
        },
      },
    } as never;
    const repo = new SettingsPrismaRepository(prisma);
    await repo.remove('GLOBAL', null, 'referrerPoints');

    expect(calls).toEqual([{ where: { scope: 'GLOBAL', depotId: null, key: 'referrerPoints' } }]);
  });
});
