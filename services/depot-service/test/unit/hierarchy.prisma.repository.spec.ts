import { HierarchyPrismaRepository } from '../../src/infrastructure/prisma/hierarchy.prisma.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// The supervision map decides which depots a supervisor can see at all, so the queries behind it
// are a security surface: a wrong `where` silently widens or empties somebody's scope. These lock
// the shape of every one of them, plus the empty-input short-circuits that must not query at all.

describe('HierarchyPrismaRepository', () => {
  const depot = { findMany: jest.fn(), update: jest.fn() };
  const staffSupervision = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  };
  const staffDepotAssignment = { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() };
  const prisma = { depot, staffSupervision, staffDepotAssignment } as unknown as PrismaService;
  const repo = new HierarchyPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('reads the depots an assistant supervises, one id or many', async () => {
    depot.findMany.mockResolvedValue([{ id: 'dep-1' }, { id: 'dep-2' }]);

    await expect(repo.depotsForAssistant('asv-1')).resolves.toEqual(['dep-1', 'dep-2']);
    expect(depot.findMany.mock.calls[0][0].where).toEqual({
      assistantSupervisorId: { in: ['asv-1'] },
    });

    await repo.depotsForAssistants(['asv-1', 'asv-2']);
    expect(depot.findMany.mock.calls[1][0].where).toEqual({
      assistantSupervisorId: { in: ['asv-1', 'asv-2'] },
    });
  });

  it('asks nothing at all for an empty staff list', async () => {
    await expect(repo.depotsForAssistants([])).resolves.toEqual([]);
    await expect(repo.subordinatesOfMany([])).resolves.toEqual([]);

    expect(depot.findMany).not.toHaveBeenCalled();
    expect(staffSupervision.findMany).not.toHaveBeenCalled();
  });

  it('reads direct reports, one superior or many', async () => {
    staffSupervision.findMany.mockResolvedValue([{ staffId: 'asv-1' }]);

    await expect(repo.subordinatesOf('spv-1')).resolves.toEqual(['asv-1']);
    expect(staffSupervision.findMany.mock.calls[0][0].where).toEqual({
      superiorId: { in: ['spv-1'] },
    });

    await repo.subordinatesOfMany(['spv-1', 'spv-2']);
    expect(staffSupervision.findMany.mock.calls[1][0].where).toEqual({
      superiorId: { in: ['spv-1', 'spv-2'] },
    });
  });

  it('reads the depots granted directly to one person', async () => {
    staffDepotAssignment.findMany.mockResolvedValue([{ depotId: 'dep-9' }]);

    await expect(repo.directDepots('spv-1')).resolves.toEqual(['dep-9']);
    expect(staffDepotAssignment.findMany.mock.calls[0][0].where).toEqual({ staffId: 'spv-1' });
  });

  it('sets and clears a depot assistant on the depot row itself', async () => {
    await repo.setDepotAssistant('dep-1', 'asv-1');
    await repo.setDepotAssistant('dep-1', null);

    expect(depot.update.mock.calls[0][0]).toEqual({
      where: { id: 'dep-1' },
      data: { assistantSupervisorId: 'asv-1' },
    });
    expect(depot.update.mock.calls[1][0].data).toEqual({ assistantSupervisorId: null });
  });

  it('upserts a superior link so re-pointing somebody does not need a delete first', async () => {
    await repo.setSuperior('asv-1', 'spv-1', 'admin-1');

    expect(staffSupervision.upsert.mock.calls[0][0]).toEqual({
      where: { staffId: 'asv-1' },
      create: { staffId: 'asv-1', superiorId: 'spv-1', updatedBy: 'admin-1' },
      update: { superiorId: 'spv-1', updatedBy: 'admin-1' },
    });
  });

  it('clearing a link that was never there is the asked-for state, not a 404', async () => {
    await repo.clearSuperior('asv-1');
    expect(staffSupervision.deleteMany.mock.calls[0][0]).toEqual({ where: { staffId: 'asv-1' } });
  });

  it('grants and revokes a direct depot', async () => {
    await repo.grantDepot('spv-1', 'dep-9', 'admin-1');
    await repo.revokeDepot('spv-1', 'dep-9');

    expect(staffDepotAssignment.upsert.mock.calls[0][0]).toMatchObject({
      where: { staffId_depotId: { staffId: 'spv-1', depotId: 'dep-9' } },
      create: { staffId: 'spv-1', depotId: 'dep-9', updatedBy: 'admin-1' },
      update: { updatedBy: 'admin-1' },
    });
    expect(staffDepotAssignment.deleteMany.mock.calls[0][0]).toEqual({
      where: { staffId: 'spv-1', depotId: 'dep-9' },
    });
  });

  it('describes a person with a superior, and one with none', async () => {
    staffSupervision.findUnique.mockResolvedValueOnce({ superiorId: 'spv-1' });
    staffSupervision.findMany.mockResolvedValue([{ staffId: 'sub-1' }]);
    depot.findMany.mockResolvedValue([{ id: 'dep-1' }]);
    staffDepotAssignment.findMany.mockResolvedValue([{ depotId: 'dep-9' }]);

    await expect(repo.describe('asv-1')).resolves.toEqual({
      superiorId: 'spv-1',
      subordinateIds: ['sub-1'],
      assistantDepotIds: ['dep-1'],
      directDepotIds: ['dep-9'],
    });

    staffSupervision.findUnique.mockResolvedValueOnce(null);
    await expect(repo.describe('direktur-1')).resolves.toMatchObject({ superiorId: null });
  });
});
