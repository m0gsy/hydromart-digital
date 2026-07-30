import { BadRequestException } from '@nestjs/common';

import { HierarchyService } from '../../src/application/services/hierarchy.service';
import { InMemoryHierarchyRepository as FakeHierarchy } from '../support/fakes';

describe('HierarchyService.scopedDepotIds', () => {
  let repo: FakeHierarchy;
  let service: HierarchyService;

  // Two assistants of 11 depots each, one supervisor over both, one manager over the
  // supervisor — the shape the business actually described.
  beforeEach(() => {
    repo = new FakeHierarchy();
    service = new HierarchyService(repo);
    for (let i = 0; i < 11; i += 1) repo.assistantOfDepot.set(`a${i}`, 'asv-1');
    for (let i = 0; i < 11; i += 1) repo.assistantOfDepot.set(`b${i}`, 'asv-2');
    repo.assistantOfDepot.set('orphan', ''); // no assistant at all
    repo.superiorOf.set('asv-1', 'spv-1');
    repo.superiorOf.set('asv-2', 'spv-1');
    repo.superiorOf.set('spv-1', 'mgr-1');
  });

  it('gives an assistant supervisor exactly their own depots', async () => {
    const ids = await service.scopedDepotIds('asv-1', 'ASSISTANT_SUPERVISOR');
    expect(ids).toHaveLength(11);
    expect(ids).toContain('a0');
    expect(ids).not.toContain('b0');
  });

  it('gives a supervisor the union of both assistants — 22 depots', async () => {
    const ids = await service.scopedDepotIds('spv-1', 'SUPERVISOR');
    expect(ids).toHaveLength(22);
    expect(ids).toContain('a0');
    expect(ids).toContain('b10');
  });

  it('gives a manager everything under their supervisors', async () => {
    const ids = await service.scopedDepotIds('mgr-1', 'MANAGER');
    expect(ids).toHaveLength(22);
  });

  // A depot nobody supervises must not leak into the chain — HQ only.
  it('never includes an unassigned depot', async () => {
    for (const [id, role] of [
      ['asv-1', 'ASSISTANT_SUPERVISOR'],
      ['spv-1', 'SUPERVISOR'],
      ['mgr-1', 'MANAGER'],
    ] as const) {
      expect(await service.scopedDepotIds(id, role)).not.toContain('orphan');
    }
  });

  it('adds a direct grant on top of the walk, without duplicating an inherited depot', async () => {
    repo.direct.set('spv-1', ['orphan', 'a0']);
    const ids = await service.scopedDepotIds('spv-1', 'SUPERVISOR');
    expect(ids).toContain('orphan');
    expect(ids.filter((d) => d === 'a0')).toHaveLength(1);
    expect(ids).toHaveLength(23);
  });

  it('gives a direct grant even with no hierarchy at all', async () => {
    repo.direct.set('mgr-9', ['orphan']);
    expect(await service.scopedDepotIds('mgr-9', 'MANAGER')).toEqual(['orphan']);
  });

  it('returns nothing for an account with no assignment — never everything', async () => {
    expect(await service.scopedDepotIds('spv-9', 'SUPERVISOR')).toEqual([]);
    expect(await service.scopedDepotIds('nobody', 'KEPALA_DEPOT')).toEqual([]);
  });
});

describe('HierarchyService.setSuperior', () => {
  let repo: FakeHierarchy;
  let service: HierarchyService;

  beforeEach(() => {
    repo = new FakeHierarchy();
    service = new HierarchyService(repo);
  });

  it('records the link', async () => {
    await service.setSuperior('asv-1', 'spv-1', 'admin-1');
    expect(repo.superiorOf.get('asv-1')).toBe('spv-1');
  });

  it('refuses to make somebody their own superior', async () => {
    await expect(service.setSuperior('spv-1', 'spv-1', null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // A cycle would leave the resolver depending on its hop bound to terminate; reject it
  // at write time instead, where there is a human to tell.
  it('refuses a link that closes a loop', async () => {
    repo.superiorOf.set('spv-1', 'mgr-1');
    await expect(service.setSuperior('mgr-1', 'spv-1', null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('clears a link and reports the shape back', async () => {
    await service.setSuperior('asv-1', 'spv-1', null);
    await service.grantDepot('asv-1', 'd9', null);
    expect(await service.describe('asv-1')).toMatchObject({
      superiorId: 'spv-1',
      directDepotIds: ['d9'],
    });
    await service.clearSuperior('asv-1');
    await service.revokeDepot('asv-1', 'd9');
    expect(await service.describe('asv-1')).toMatchObject({
      superiorId: null,
      directDepotIds: [],
    });
  });
});
