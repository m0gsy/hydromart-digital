import { ForbiddenException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { ResellerService } from '../../src/application/services/reseller.service';
import { ProfileRepository } from '../../src/application/ports/profile.repository';
import { Reseller, ResellerRepository } from '../../src/application/ports/reseller.repository';
import {
  CustomerNotFoundError,
  ResellerExistsError,
  ResellerNotFoundError,
} from '../../src/domain/errors';

function row(over: Partial<Reseller> = {}): Reseller {
  return {
    customerId: 'c1',
    homeDepotId: 'd1',
    monthlyTargetQty: 100,
    active: true,
    joinDate: new Date('2026-01-01'),
    note: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  };
}

function makeRepo(): jest.Mocked<ResellerRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
}

// Minimal ProfileRepository stub: only `exists` is used by the service.
function makeProfiles(exists: boolean) {
  return { exists: jest.fn().mockResolvedValue(exists) } as unknown as ProfileRepository;
}

const manager = (depotId = 'd1'): AuthenticatedUser => ({
  sub: 'u1',
  role: Role.DEPOT_MANAGER,
  phone: null,
  depotId,
});
const hq: AuthenticatedUser = { sub: 'u2', role: Role.HEAD_OFFICE, phone: null, depotId: null };

describe('ResellerService', () => {
  it('registers a reseller for an existing customer', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    repo.create.mockResolvedValue(row());
    const svc = new ResellerService(repo, makeProfiles(true));

    const out = await svc.register(hq, {
      customerId: 'c1',
      homeDepotId: 'd1',
      monthlyTargetQty: 100,
      joinDate: new Date('2026-01-01'),
    });

    expect(out.customerId).toBe('c1');
    expect(repo.create).toHaveBeenCalled();
  });

  it('rejects a customerId that is not a customer', async () => {
    const repo = makeRepo();
    const svc = new ResellerService(repo, makeProfiles(false));
    await expect(
      svc.register(hq, { customerId: 'x', homeDepotId: 'd1', monthlyTargetQty: 0, joinDate: new Date() }),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('rejects registering the same customer twice', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(row());
    const svc = new ResellerService(repo, makeProfiles(true));
    await expect(
      svc.register(hq, { customerId: 'c1', homeDepotId: 'd1', monthlyTargetQty: 0, joinDate: new Date() }),
    ).rejects.toBeInstanceOf(ResellerExistsError);
  });

  it('throws when updating an unknown reseller', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const svc = new ResellerService(repo, makeProfiles(true));
    await expect(svc.update(hq, 'nope', { active: false })).rejects.toBeInstanceOf(
      ResellerNotFoundError,
    );
  });

  describe('depot tenant isolation', () => {
    it('forces a depot-locked manager list to their own depot when none is requested', async () => {
      const repo = makeRepo();
      repo.list.mockResolvedValue([]);
      const svc = new ResellerService(repo, makeProfiles(true));

      await svc.list(manager('d1'), {});

      expect(repo.list).toHaveBeenCalledWith({ homeDepotId: 'd1', active: undefined });
    });

    it('rejects a depot-locked manager listing a different depot', async () => {
      const repo = makeRepo();
      repo.list.mockResolvedValue([]);
      const svc = new ResellerService(repo, makeProfiles(true));

      await expect(svc.list(manager('d1'), { homeDepotId: 'd2' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.list).not.toHaveBeenCalled();
    });

    it('lets an HQ user list any depot (or all depots)', async () => {
      const repo = makeRepo();
      repo.list.mockResolvedValue([]);
      const svc = new ResellerService(repo, makeProfiles(true));

      await svc.list(hq, { homeDepotId: 'd2' });

      expect(repo.list).toHaveBeenCalledWith({ homeDepotId: 'd2', active: undefined });
    });

    it('lets a depot-locked manager register a reseller at their own depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(null);
      repo.create.mockResolvedValue(row({ homeDepotId: 'd1' }));
      const svc = new ResellerService(repo, makeProfiles(true));

      await svc.register(manager('d1'), {
        customerId: 'c1',
        homeDepotId: 'd1',
        monthlyTargetQty: 100,
        joinDate: new Date('2026-01-01'),
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ homeDepotId: 'd1' }),
      );
    });

    it('rejects a manager registering a reseller homed at another depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(null);
      const svc = new ResellerService(repo, makeProfiles(true));

      await expect(
        svc.register(manager('d1'), {
          customerId: 'c1',
          homeDepotId: 'd2',
          monthlyTargetQty: 100,
          joinDate: new Date('2026-01-01'),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('lets HQ register a reseller at any depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(null);
      repo.create.mockResolvedValue(row({ homeDepotId: 'd2' }));
      const svc = new ResellerService(repo, makeProfiles(true));

      await svc.register(hq, {
        customerId: 'c1',
        homeDepotId: 'd2',
        monthlyTargetQty: 100,
        joinDate: new Date('2026-01-01'),
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ homeDepotId: 'd2' }));
    });

    it('rejects a manager reading another depot reseller by id', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd2' }));
      const svc = new ResellerService(repo, makeProfiles(true));

      await expect(svc.get(manager('d1'), 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a manager read their own depot reseller by id', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd1' }));
      const svc = new ResellerService(repo, makeProfiles(true));

      await expect(svc.get(manager('d1'), 'c1')).resolves.toMatchObject({ homeDepotId: 'd1' });
    });

    it('lets HQ read any depot reseller by id', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd2' }));
      const svc = new ResellerService(repo, makeProfiles(true));

      await expect(svc.get(hq, 'c1')).resolves.toMatchObject({ homeDepotId: 'd2' });
    });

    it('rejects a manager updating another depot reseller', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd2' }));
      const svc = new ResellerService(repo, makeProfiles(true));

      await expect(
        svc.update(manager('d1'), 'c1', { active: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a manager moving their own reseller to another depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd1' }));
      const svc = new ResellerService(repo, makeProfiles(true));

      await expect(
        svc.update(manager('d1'), 'c1', { homeDepotId: 'd2' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets HQ update a reseller at any depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd2' }));
      repo.update.mockResolvedValue(row({ homeDepotId: 'd2', active: false }));
      const svc = new ResellerService(repo, makeProfiles(true));

      await expect(svc.update(hq, 'c1', { active: false })).resolves.toMatchObject({
        active: false,
      });
    });
  });
});
