import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ProfileNotFoundError } from '../../src/domain/errors';
import { DepotCrmService } from '../../src/application/services/depot-crm.service';
import { ResellerService } from '../../src/application/services/reseller.service';
import { OrderCrmHttpAdapter } from '../../src/infrastructure/http/order-crm.http.adapter';
import { ProfilePrismaRepository } from '../../src/infrastructure/prisma/profile.prisma.repository';
import { ProfileController } from '../../src/modules/profile.controller';
import { InternalController } from '../../src/modules/internal.controller';
import { ImportCustomersDto, ImportResellersDto } from '../../src/modules/dto/customer-import.dto';
import { buildTestConfig } from '../support/fakes';

/** Names are a decoration on the roster; every reseller test here is about the roster. */
function fakeIdentity() {
  return { getCustomerNames: async () => new Map(), preRegisterCustomer: async () => ({ customerId: 'x', status: 'created' as const }) } as never;
}


describe('DepotCrmService follow-up list', () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    customerId: 'c1',
    name: 'Budi',
    phone: '+62811',
    lastOrderAt: new Date('2026-01-01T00:00:00.000Z'),
    orderCount: 3,
    totalSpent: 150_000.4,
    ...over,
  });

  const build = (rows: unknown[]) =>
    new DepotCrmService(
      {} as never,
      {} as never,
      {} as never,
      { depotCustomerStats: async () => rows } as never,
      { gallonsByCustomer: async () => null } as never,
      { getCustomerNames: async () => new Map() } as never,
      buildTestConfig(),
    );

  // Longest-silent first: the whole point of the list is who to call TODAY.
  it('sorts follow-ups by days since the last order, descending', async () => {
    const out = await build([
      summary({ customerId: 'recent', lastOrderAt: new Date('2020-06-01T00:00:00.000Z') }),
      summary({ customerId: 'stale', lastOrderAt: new Date('2019-01-01T00:00:00.000Z') }),
    ]).getCrmDashboard('depot-1');
    const ids = out.followUps.map((f) => f.customerId);
    expect(ids.indexOf('stale')).toBeLessThan(ids.indexOf('recent'));
  });

  // A customer who has never ordered cannot have gone quiet — they are a lead, not a
  // lapsed regular, and putting them in the call queue would bury the real ones.
  it('keeps a customer who never ordered out of the follow-up queue', async () => {
    const out = await build([
      summary({ customerId: 'never', lastOrderAt: null, orderCount: 0 }),
    ]).getCrmDashboard('depot-1');
    expect(out.followUps).toHaveLength(0);
    expect(out.counts.total).toBe(1);
  });

  it('reports a repeat rate of 0 rather than dividing by zero on an empty depot', async () => {
    expect((await build([]).getCrmDashboard('depot-1')).repeatRatePct).toBe(0);
  });
});

describe('ResellerService.findMy', () => {
  it('hands back the caller own reseller row', async () => {
    const row = { id: 'c1', discountPct: 5 };
    const svc = new ResellerService({ findById: async () => row } as never, {} as never, fakeIdentity());
    expect(await svc.findMy('c1')).toBe(row);
  });

  // Not an error: most customers are simply not resellers, and the wallet screen
  // asks unconditionally.
  it('returns null for a customer who is not a reseller', async () => {
    const svc = new ResellerService({ findById: async () => null } as never, {} as never, fakeIdentity());
    expect(await svc.findMy('c9')).toBeNull();
  });
});

describe('ResellerService.get', () => {
  it('404s for an id that is not a reseller', async () => {
    const svc = new ResellerService({ findById: async () => null } as never, {} as never, fakeIdentity());
    await expect(svc.get({ sub: 'staff' } as never, 'c9')).rejects.toThrow();
  });

  // A reseller belongs to a depot, so a depot-scoped caller must not read one outside
  // their own set — the row is loaded first, then checked.
  it('refuses a depot-scoped caller reading a reseller from another depot', async () => {
    const svc = new ResellerService(
      { findById: async () => ({ id: 'c1', homeDepotId: 'depot-other' }) } as never,
      {} as never,
      fakeIdentity(),
    );
    await expect(
      svc.get({ sub: 's', role: 'KEPALA_DEPOT', depotId: 'depot-mine' } as never, 'c1'),
    ).rejects.toThrow();
  });

  it('returns the row for a caller inside the right depot', async () => {
    const row = { id: 'c1', homeDepotId: 'depot-mine' };
    const svc = new ResellerService({ findById: async () => row } as never, {} as never, fakeIdentity());
    expect(await svc.get({ sub: 's', role: 'KEPALA_DEPOT', depotId: 'depot-mine' } as never, 'c1')).toBe(
      row,
    );
  });
});

describe('ProfileController birthdate patch', () => {
  const controller = (setBirthdate: jest.Mock) =>
    new ProfileController(
      {
        get: jest.fn().mockResolvedValue({ customerId: 'c1' }),
        setBirthdate,
        setFavoriteDepot: jest.fn(),
      } as never,
      {} as never,
    );

  it('parses a supplied birthdate into a Date', async () => {
    const setBirthdate = jest.fn().mockResolvedValue({});
    await controller(setBirthdate).updateProfile({ sub: 'c1' } as never, {
      birthdate: '1990-05-17',
    } as never);
    expect(setBirthdate).toHaveBeenCalledWith('c1', new Date('1990-05-17'));
  });

  // An explicit null is "clear my birthday", which is different from not sending the
  // field at all — the `in` check above is what keeps those apart.
  it('clears the birthdate when the field is sent as null', async () => {
    const setBirthdate = jest.fn().mockResolvedValue({});
    await controller(setBirthdate).updateProfile({ sub: 'c1' } as never, {
      birthdate: null,
    } as never);
    expect(setBirthdate).toHaveBeenCalledWith('c1', null);
  });
});

describe('CustomerConfigService.productServiceUrl', () => {
  it('trims a configured url', () => {
    expect(buildTestConfig({ PRODUCT_SERVICE_URL: '  http://product:3002  ' }).productServiceUrl).toBe(
      'http://product:3002',
    );
  });

  // Blank means "skip the catalog check" — a whitespace-only value must read as blank,
  // not as a URL that every fetch then fails on.
  it('reads a whitespace-only value as unconfigured', () => {
    expect(buildTestConfig({ PRODUCT_SERVICE_URL: '   ' }).productServiceUrl).toBe('');
    expect(buildTestConfig().productServiceUrl).toBe('');
  });
});

describe('ProfileNotFoundError', () => {
  it('carries a stable code and a 404', () => {
    const err = new ProfileNotFoundError();
    expect(err).toMatchObject({ code: 'CUSTOMER_PROFILE_NOT_FOUND', status: 404 });
    expect(err.message).toContain('not found');
  });
});

describe('OrderCrmHttpAdapter failure', () => {
  // Fail SOFT: the CRM page is a read. An unreachable order-service should blank the
  // order columns, never 500 the whole depot's customer list.
  it('returns an empty list and warns when order-service is unreachable', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const adapter = new OrderCrmHttpAdapter(
      buildTestConfig({ ORDER_SERVICE_URL: 'http://order:3003', INTERNAL_SERVICE_KEY: 'k' }),
    );
    const warn = jest.spyOn(adapter['logger'], 'warn').mockImplementation(() => undefined);
    expect(await adapter.depotCustomerStats('depot-1')).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ProfilePrismaRepository.exists', () => {
  it.each([
    ['a profile that exists', 1, true],
    ['no profile', 0, false],
  ])('reports %s', async (_case, count, expected) => {
    const repo = new ProfilePrismaRepository({
      customerProfile: { count: jest.fn().mockResolvedValue(count) },
    } as never);
    expect(await repo.exists('c1')).toBe(expected);
  });
});

describe('ProfileController.getNotifications', () => {
  it('reads the preferences of the CALLER, never an id from the request', async () => {
    const get = jest.fn().mockResolvedValue({ orderUpdates: true });
    const controller = new ProfileController({} as never, { get } as never);
    expect(await controller.getNotifications({ sub: 'c1' } as never)).toEqual({
      orderUpdates: true,
    });
    expect(get).toHaveBeenCalledWith('c1');
  });
});

describe('ImportCustomersDto', () => {
  const DEPOT = '11111111-1111-4111-8111-111111111111';

  // Without @Type the nested rows arrive as plain objects and every per-row rule is
  // skipped — the import would accept anything.
  it('validates each nested row', () => {
    const good = plainToInstance(ImportCustomersDto, {
      depotId: DEPOT,
      rows: [{ phone: '+6281234567890', fullName: 'Budi' }],
    });
    expect(validateSync(good)).toHaveLength(0);

    const bad = plainToInstance(ImportCustomersDto, {
      depotId: DEPOT,
      rows: [{ fullName: 'No Phone' }],
    });
    expect(validateSync(bad).length).toBeGreaterThan(0);
  });

  it('refuses a batch over the size cap', () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      phone: `+62812345${String(i).padStart(5, '0')}`,
      fullName: 'X',
    }));
    expect(
      validateSync(plainToInstance(ImportCustomersDto, { depotId: DEPOT, rows })).length,
    ).toBeGreaterThan(0);
  });

  it('validates each nested RESELLER row too', () => {
    const row = {
      fullName: 'Toko Berkah',
      phone: '+6281234567890',
      discountPct: 5,
      monthlyTargetQty: 100,
      joinDate: '2026-01-01',
    };
    expect(validateSync(plainToInstance(ImportResellersDto, { depotId: DEPOT, rows: [row] }))).toHaveLength(
      0,
    );
    expect(
      validateSync(
        plainToInstance(ImportResellersDto, {
          depotId: DEPOT,
          rows: [{ ...row, discountPct: 101 }],
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
});

/*
 * §I + J-2: the three branches the directory grew.
 *
 * - a customer who has ORDERED here but was never recorded here is still listed;
 * - the gallon ledger's `null` (unread) and a missing row (owes nothing) are different;
 * - `claimFavoriteDepot` writes only when there is no favourite.
 */
describe('DepotCrmService directory union and ledger (§I, J-2)', () => {
  const DEPOT = 'depot-a';
  const orderer = {
    customerId: 'c-orderer',
    name: 'Sari',
    phone: '+62822',
    orderCount: 4,
    totalSpent: 100_000,
    firstOrderAt: new Date('2026-07-01T00:00:00.000Z'),
    lastOrderAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  const profileRow = {
    customerId: 'c-profile',
    fullName: 'Budi',
    phone: '+62811',
    membershipTier: 'BASIC',
  };

  const build = (ledger: unknown) =>
    new DepotCrmService(
      { listDepotCustomers: async () => [profileRow] } as never,
      {} as never,
      { claimFavoriteDepotIfUnset: async () => true } as never,
      { depotCustomerStats: async () => [orderer] } as never,
      { gallonsByCustomer: async () => ledger } as never,
      { getCustomerNames: async () => new Map() } as never,
      buildTestConfig(),
    );

  it('lists somebody who only ever ordered here, alongside the recorded profiles', async () => {
    const rows = await build(null).listDepotCustomers(DEPOT);
    expect(rows.map((r) => r.id).sort()).toEqual(['c-orderer', 'c-profile']);
    // Name and phone fall back to the order snapshot for the row with no profile.
    expect(rows.find((r) => r.id === 'c-orderer')).toMatchObject({
      fullName: 'Sari',
      phone: '+62822',
    });
  });

  it('reports an unread ledger as null on every row, not as zero', async () => {
    const rows = await build(null).listDepotCustomers(DEPOT);
    for (const r of rows) {
      expect(r.gallonsOnLoan).toBeNull();
      expect(r.depositHeldIdr).toBeNull();
    }
  });

  it('reports a read ledger as numbers, and 0 for a customer it does not mention', async () => {
    const rows = await build([
      { customerId: 'c-profile', gallonsOnLoan: 3, depositHeldIdr: 60_000 },
    ]).listDepotCustomers(DEPOT);

    expect(rows.find((r) => r.id === 'c-profile')).toMatchObject({
      gallonsOnLoan: 3,
      depositHeldIdr: 60_000,
    });
    expect(rows.find((r) => r.id === 'c-orderer')).toMatchObject({
      gallonsOnLoan: 0,
      depositHeldIdr: 0,
    });
  });

  it('hands the favourite-depot claim to the repository', async () => {
    await expect(build(null).claimFavoriteDepot('c1', DEPOT)).resolves.toBe(true);
  });
});

/*
 * §I: the favourite depot is claimed only when there is none. Three shapes, because the
 * write is one statement with the null guard in its `where` — a read-then-write here would
 * lose a race with a second checkout and move somebody who already belongs elsewhere.
 */
describe('ProfilePrismaRepository.claimFavoriteDepotIfUnset (§I)', () => {
  const make = (over: Record<string, unknown>) =>
    new ProfilePrismaRepository({
      customerProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        ...over,
      },
    } as never);

  it('claims an existing profile that has no favourite yet', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repo = make({ updateMany });
    await expect(repo.claimFavoriteDepotIfUnset('c1', 'd1')).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { customerId: 'c1', favoriteDepotId: null },
      data: { favoriteDepotId: 'd1' },
    });
  });

  it('leaves a profile that already has one alone', async () => {
    const create = jest.fn();
    const repo = make({
      findUnique: jest.fn().mockResolvedValue({ favoriteDepotId: 'd-other' }),
      create,
    });
    await expect(repo.claimFavoriteDepotIfUnset('c1', 'd1')).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  // Registration makes the profile lazily, so a first-time buyer may have none at all.
  it('creates the profile when the customer has none', async () => {
    const create = jest.fn().mockResolvedValue({});
    const repo = make({ create });
    await expect(repo.claimFavoriteDepotIfUnset('c1', 'd1')).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({ data: { customerId: 'c1', favoriteDepotId: 'd1' } });
  });
});

describe('DepotCrmService directory search and name fallbacks', () => {
  const stat = (over: Record<string, unknown> = {}) => ({
    customerId: 'c-orderer',
    name: null,
    phone: null,
    orderCount: 1,
    totalSpent: 1000,
    firstOrderAt: null,
    lastOrderAt: null,
    ...over,
  });

  const build = (stats: unknown[], profiles: unknown[] = []) =>
    new DepotCrmService(
      { listDepotCustomers: async () => profiles } as never,
      {} as never,
      {} as never,
      { depotCustomerStats: async () => stats } as never,
      { gallonsByCustomer: async () => null } as never,
      { getCustomerNames: async () => new Map() } as never,
      buildTestConfig(),
    );

  // §I: an order snapshot can carry neither a name nor a phone (an unnamed walk-in that
  // was later identified). The row still lists; it just has nothing to show.
  it('lists an orderer whose snapshot has no name or phone', async () => {
    const rows = await build([stat()]).listDepotCustomers('d1');
    expect(rows[0]).toMatchObject({ id: 'c-orderer', fullName: null, phone: null });
  });

  it('filters by name and by phone, and returns everything with no query', async () => {
    const service = build([
      stat({ customerId: 'c1', name: 'Budi', phone: '+62811' }),
      stat({ customerId: 'c2', name: 'Sari', phone: '+62899' }),
    ]);
    expect((await service.listDepotCustomers('d1', 'bud')).map((r) => r.id)).toEqual(['c1']);
    expect((await service.listDepotCustomers('d1', '899')).map((r) => r.id)).toEqual(['c2']);
    expect(await service.listDepotCustomers('d1', '   ')).toHaveLength(2);
    // Neither field matches, and neither is null — the "no match" branch.
    expect(await service.listDepotCustomers('d1', 'zzz')).toHaveLength(0);
  });

  it('does not match a row whose name and phone are both missing', async () => {
    const rows = await build([stat()]).listDepotCustomers('d1', 'budi');
    expect(rows).toHaveLength(0);
  });
});

describe('InternalController.claimFavoriteDepot', () => {
  it('reports whether the depot was recorded', async () => {
    const crm = { claimFavoriteDepot: jest.fn().mockResolvedValue(true) };
    const controller = new InternalController(crm as never, {} as never, {} as never);
    await expect(
      controller.claimFavoriteDepot({ customerId: 'c1', depotId: 'd1' }),
    ).resolves.toEqual({ claimed: true });
    expect(crm.claimFavoriteDepot).toHaveBeenCalledWith('c1', 'd1');
  });
});
