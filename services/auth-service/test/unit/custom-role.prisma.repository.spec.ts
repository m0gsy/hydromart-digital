import { CustomRolePrismaRepository } from '../../src/infrastructure/prisma/repositories/custom-role.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const D = '11111111-1111-1111-1111-111111111111';

function setup() {
  const prisma = {
    customRole: {
      findMany: jest.fn().mockResolvedValue([{ key: 'C_a', scope: 'LOCKED' }]),
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockReturnValue('role-update'),
    },
    capabilityOverride: {
      findMany: jest.fn().mockResolvedValue([
        { capability: 'dashboard', roles: ['C_a', 'MANAGER'] },
        { capability: 'approvals', roles: ['C_a'] },
      ]),
      update: jest.fn().mockImplementation((a: unknown) => a),
    },
    capabilityDepotOverride: {
      findMany: jest.fn().mockResolvedValue([{ capability: 'dashboard', effect: 'DENY' }]),
      upsert: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockReturnValue('depot-delete'),
    },
    roleSetting: {
      findMany: jest.fn().mockResolvedValue([{ roleKey: 'MANAGER', scope: 'LOCKED' }]),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    customer: { count: jest.fn().mockResolvedValue(4) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { prisma, repo: new CustomRolePrismaRepository(prisma as unknown as PrismaService) };
}

describe('CustomRolePrismaRepository', () => {
  it('lists, finds (present and absent), creates and updates', async () => {
    const { prisma, repo } = setup();
    expect(await repo.listAll()).toEqual([{ key: 'C_a', scope: 'LOCKED' }]);
    prisma.customRole.findUnique.mockResolvedValueOnce({ key: 'C_a', scope: 'GLOBAL' });
    expect(await repo.find('C_a')).toEqual({ key: 'C_a', scope: 'GLOBAL' });
    prisma.customRole.findUnique.mockResolvedValueOnce(null);
    expect(await repo.find('C_x')).toBeNull();
    await repo.create({ key: 'C_a', name: 'A', description: null, scope: 'LOCKED', createdBy: null });
    expect(prisma.customRole.create).toHaveBeenCalled();
    prisma.customRole.update.mockResolvedValue(undefined);
    await repo.update('C_a', { name: 'B' });
    expect(prisma.customRole.update).toHaveBeenCalledWith({ where: { key: 'C_a' }, data: { name: 'B' } });
  });

  it('archive is ONE transaction: archive the role, strip it from every list, drop its depot rows', async () => {
    const { prisma, repo } = setup();
    await repo.archive('C_a');
    expect(prisma.capabilityOverride.findMany).toHaveBeenCalledWith({ where: { roles: { has: 'C_a' } } });
    const ops = prisma.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(4);
    expect(prisma.capabilityOverride.update).toHaveBeenCalledWith({
      where: { capability: 'dashboard' },
      data: { roles: ['MANAGER'] },
    });
    expect(prisma.capabilityOverride.update).toHaveBeenCalledWith({
      where: { capability: 'approvals' },
      data: { roles: [] },
    });
    expect(prisma.capabilityDepotOverride.deleteMany).toHaveBeenCalledWith({ where: { roleKey: 'C_a' } });
  });

  it('counts holders from the accounts table', async () => {
    const { prisma, repo } = setup();
    expect(await repo.countHolders('C_a')).toBe(4);
    expect(prisma.customer.count).toHaveBeenCalledWith({ where: { role: 'C_a' } });
  });

  it('lists, upserts and removes depot overrides', async () => {
    const { prisma, repo } = setup();
    expect(await repo.listDepotOverrides()).toEqual([{ capability: 'dashboard', effect: 'DENY' }]);
    await repo.setDepotOverride({ capability: 'dashboard', roleKey: 'C_a', depotId: D, effect: 'GRANT' }, 'admin');
    expect(prisma.capabilityDepotOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capability_roleKey_depotId: { capability: 'dashboard', roleKey: 'C_a', depotId: D } },
        update: { effect: 'GRANT', updatedBy: 'admin' },
      }),
    );
    prisma.capabilityDepotOverride.deleteMany.mockResolvedValue({ count: 0 });
    await repo.removeDepotOverride('dashboard', 'C_a', D);
    expect(prisma.capabilityDepotOverride.deleteMany).toHaveBeenCalledWith({
      where: { capability: 'dashboard', roleKey: 'C_a', depotId: D },
    });
  });

  it('lists and upserts built-in role settings', async () => {
    const { prisma, repo } = setup();
    expect(await repo.listRoleSettings()).toEqual([{ roleKey: 'MANAGER', scope: 'LOCKED' }]);
    await repo.upsertRoleSetting('MANAGER', { name: 'Mgr', disabledAt: null }, 'admin');
    expect(prisma.roleSetting.upsert).toHaveBeenCalledWith({
      where: { roleKey: 'MANAGER' },
      create: { roleKey: 'MANAGER', name: 'Mgr', disabledAt: null, updatedBy: 'admin' },
      update: { name: 'Mgr', disabledAt: null, updatedBy: 'admin' },
    });
  });
});
