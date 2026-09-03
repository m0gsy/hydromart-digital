import { ForbiddenException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { ResellerService } from '../../src/application/services/reseller.service';
import { ProfileRepository } from '../../src/application/ports/profile.repository';
import { Reseller, ResellerRepository } from '../../src/application/ports/reseller.repository';
import { ResellerExistsError, ResellerNotFoundError } from '../../src/domain/errors';

/** Names are a decoration on the roster; every reseller test here is about the roster. */
function fakeIdentity() {
  return {
    getCustomerNames: async () => new Map(),
    preRegisterCustomer: async () => ({ customerId: 'x', status: 'created' as const }),
  } as never;
}

function row(over: Partial<Reseller> = {}): Reseller {
  return {
    customerId: 'c1',
    homeDepotId: 'd1',
    monthlyTargetQty: 100,
    discountPct: 0,
    flatGallonPriceIdr: 0,
    photoUrl: null,
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
    recordPriceChange: jest.fn(),
    listPriceChanges: jest.fn(),
    findDuePriceChanges: jest.fn(),
    markPriceChangeApplied: jest.fn(),
  };
}

/** K4.2: the notice to the agen. Records what was sent; never fails the change. */
function makeNotifier() {
  return { priceChanged: jest.fn().mockResolvedValue(true) };
}

// Minimal ProfileRepository stub: only `exists` is used by the service.
function makeProfiles(exists: boolean) {
  return {
    exists: jest.fn().mockResolvedValue(exists),
    create: jest.fn().mockResolvedValue({ customerId: 'x' }),
  } as unknown as ProfileRepository;
}

const manager = (depotId = 'd1'): AuthenticatedUser => ({
  sub: 'u1',
  role: Role.MANAGER,
  phone: null,
  depotId,
});
const hq: AuthenticatedUser = { sub: 'u2', role: Role.HEAD_OFFICE, phone: null, depotId: null };

describe('ResellerService', () => {
  it('registers a reseller for an existing customer', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    repo.create.mockResolvedValue(row());
    const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

    const out = await svc.register(hq, {
      customerId: 'c1',
      homeDepotId: 'd1',
      monthlyTargetQty: 100,
      joinDate: new Date('2026-01-01'),
    });

    expect(out.customerId).toBe('c1');
    expect(repo.create).toHaveBeenCalled();
  });

  it('persists discountPct on register and defaults it to 0', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    repo.create.mockImplementation((data) =>
      Promise.resolve(row({ customerId: data.customerId, discountPct: data.discountPct ?? 0 })),
    );
    const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

    const withPct = await svc.register(hq, {
      customerId: 'c1',
      homeDepotId: 'd1',
      monthlyTargetQty: 100,
      discountPct: 15,
      joinDate: new Date('2026-01-01'),
    });
    expect(withPct.discountPct).toBe(15);

    const noPct = await svc.register(hq, {
      customerId: 'c2',
      homeDepotId: 'd1',
      monthlyTargetQty: 0,
      joinDate: new Date('2026-01-01'),
    });
    expect(noPct.discountPct).toBe(0);
  });

  it('creates the profile shell for a customer who has never opened theirs', async () => {
    const repo = makeRepo();
    const profiles = makeProfiles(false);
    const svc = new ResellerService(repo, profiles, fakeIdentity(), makeNotifier());
    await svc.register(hq, {
      customerId: 'x',
      homeDepotId: 'd1',
      monthlyTargetQty: 0,
      joinDate: new Date(),
    });
    expect(profiles.create).toHaveBeenCalledWith('x');
    expect(repo.create).toHaveBeenCalled();
  });

  it('rejects registering the same customer twice', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(row());
    const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());
    await expect(
      svc.register(hq, {
        customerId: 'c1',
        homeDepotId: 'd1',
        monthlyTargetQty: 0,
        joinDate: new Date(),
      }),
    ).rejects.toBeInstanceOf(ResellerExistsError);
  });

  it('throws when updating an unknown reseller', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());
    await expect(svc.update(hq, 'nope', { active: false })).rejects.toBeInstanceOf(
      ResellerNotFoundError,
    );
  });

  /*
   * A6/A9. `get` refuses a depot the console caller has no business seeing, and that is
   * right for a console. It was wrong for PRICING: order-service asked it on behalf of a
   * cashier, `resellerView` lists neither KEPALA_DEPOT nor STAFF_DEPOT, so the read 403'd
   * and every agen at a counter was charged retail. `pricingFor` answers the same row with
   * no depot check — the depot question moves to order-service, which knows who is selling.
   */
  describe('pricingFor (A6): the same row without the console depot check', () => {
    it('answers for a reseller whose depot the caller could never read', async () => {
      const repo = makeRepo();
      const other = row({ homeDepotId: 'depot-not-mine' });
      repo.findById.mockResolvedValue(other);
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await expect(svc.pricingFor('c1')).resolves.toBe(other);
    });

    // "Not a reseller" must stay a distinct answer: the adapter keys fail-closed on it.
    it('still throws not-found for a customer who is not a reseller', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(null);
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());
      await expect(svc.pricingFor('nope')).rejects.toBeInstanceOf(ResellerNotFoundError);
    });
  });

  // §G-3. The roster used to render a 36-character UUID as the whole Customer column,
  // because the name is on the account and this table only has the id.
  describe('the roster carries the account name', () => {
    it('decorates each row with the name behind its customer id', async () => {
      const repo = makeRepo();
      repo.list.mockResolvedValue([row(), row({ customerId: 'c2' })]);
      const identity = {
        getCustomerNames: jest
          .fn()
          .mockResolvedValue(new Map([['c1', { fullName: 'Budi', phone: '0811' }]])),
      } as never;

      const out = await new ResellerService(
        repo,
        makeProfiles(true),
        identity,
        makeNotifier() as never,
      ).list(hq, {});

      expect(out.map((r) => [r.customerId, r.customerName])).toEqual([
        ['c1', 'Budi'],
        // No account name (a pre-registered import that never signed in): null, so the
        // page falls back rather than printing an empty cell as if it were the name.
        ['c2', null],
      ]);
    });

    // Fail-soft, like every other use of the lookup: the roster is the answer, the names
    // are a decoration on it.
    it('still lists the roster when the name lookup comes back empty', async () => {
      const repo = makeRepo();
      repo.list.mockResolvedValue([row()]);

      const out = await new ResellerService(
        repo,
        makeProfiles(true),
        fakeIdentity(),
        makeNotifier(),
      ).list(hq, {});

      expect(out).toHaveLength(1);
      expect(out[0].customerName).toBeNull();
    });
  });

  describe('depot tenant isolation', () => {
    it('forces a depot-locked manager list to their own depot when none is requested', async () => {
      const repo = makeRepo();
      repo.list.mockResolvedValue([]);
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await svc.list(manager('d1'), {});

      expect(repo.list).toHaveBeenCalledWith({ homeDepotIds: ['d1'], active: undefined });
    });

    it('rejects a depot-locked manager listing a different depot', async () => {
      const repo = makeRepo();
      repo.list.mockResolvedValue([]);
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await expect(svc.list(manager('d1'), { homeDepotId: 'd2' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.list).not.toHaveBeenCalled();
    });

    it('lets an HQ user list any depot (or all depots)', async () => {
      const repo = makeRepo();
      repo.list.mockResolvedValue([]);
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await svc.list(hq, { homeDepotId: 'd2' });

      expect(repo.list).toHaveBeenCalledWith({ homeDepotIds: ['d2'], active: undefined });
    });

    it('lets a depot-locked manager register a reseller at their own depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(null);
      repo.create.mockResolvedValue(row({ homeDepotId: 'd1' }));
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await svc.register(manager('d1'), {
        customerId: 'c1',
        homeDepotId: 'd1',
        monthlyTargetQty: 100,
        joinDate: new Date('2026-01-01'),
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ homeDepotId: 'd1' }));
    });

    it('rejects a manager registering a reseller homed at another depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(null);
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

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
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

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
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await expect(svc.get(manager('d1'), 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a manager read their own depot reseller by id', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd1' }));
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await expect(svc.get(manager('d1'), 'c1')).resolves.toMatchObject({ homeDepotId: 'd1' });
    });

    it('lets HQ read any depot reseller by id', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd2' }));
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await expect(svc.get(hq, 'c1')).resolves.toMatchObject({ homeDepotId: 'd2' });
    });

    it('rejects a manager updating another depot reseller', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd2' }));
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await expect(svc.update(manager('d1'), 'c1', { active: false })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a manager moving their own reseller to another depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd1' }));
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await expect(svc.update(manager('d1'), 'c1', { homeDepotId: 'd2' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets HQ update a reseller at any depot', async () => {
      const repo = makeRepo();
      repo.findById.mockResolvedValue(row({ homeDepotId: 'd2' }));
      repo.update.mockResolvedValue(row({ homeDepotId: 'd2', active: false }));
      const svc = new ResellerService(repo, makeProfiles(true), fakeIdentity(), makeNotifier());

      await expect(svc.update(hq, 'c1', { active: false })).resolves.toMatchObject({
        active: false,
      });
    });
  });
});
