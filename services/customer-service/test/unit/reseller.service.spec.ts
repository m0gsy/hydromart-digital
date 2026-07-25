import { ResellerService } from '../../src/application/services/reseller.service';
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
  return { exists: jest.fn().mockResolvedValue(exists) } as any;
}

describe('ResellerService', () => {
  it('registers a reseller for an existing customer', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    repo.create.mockResolvedValue(row());
    const svc = new ResellerService(repo, makeProfiles(true));

    const out = await svc.register({
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
      svc.register({ customerId: 'x', homeDepotId: 'd1', monthlyTargetQty: 0, joinDate: new Date() }),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('rejects registering the same customer twice', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(row());
    const svc = new ResellerService(repo, makeProfiles(true));
    await expect(
      svc.register({ customerId: 'c1', homeDepotId: 'd1', monthlyTargetQty: 0, joinDate: new Date() }),
    ).rejects.toBeInstanceOf(ResellerExistsError);
  });

  it('throws when updating an unknown reseller', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const svc = new ResellerService(repo, makeProfiles(true));
    await expect(svc.update('nope', { active: false })).rejects.toBeInstanceOf(ResellerNotFoundError);
  });
});
