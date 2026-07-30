import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ProfileNotFoundError } from '../../src/domain/errors';
import { DepotCrmService } from '../../src/application/services/depot-crm.service';
import { ResellerService } from '../../src/application/services/reseller.service';
import { OrderCrmHttpAdapter } from '../../src/infrastructure/http/order-crm.http.adapter';
import { ProfilePrismaRepository } from '../../src/infrastructure/prisma/profile.prisma.repository';
import { ProfileController } from '../../src/modules/profile.controller';
import { ImportCustomersDto, ImportResellersDto } from '../../src/modules/dto/customer-import.dto';
import { buildTestConfig } from '../support/fakes';

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
    const svc = new ResellerService({ findById: async () => row } as never, {} as never);
    expect(await svc.findMy('c1')).toBe(row);
  });

  // Not an error: most customers are simply not resellers, and the wallet screen
  // asks unconditionally.
  it('returns null for a customer who is not a reseller', async () => {
    const svc = new ResellerService({ findById: async () => null } as never, {} as never);
    expect(await svc.findMy('c9')).toBeNull();
  });
});

describe('ResellerService.get', () => {
  it('404s for an id that is not a reseller', async () => {
    const svc = new ResellerService({ findById: async () => null } as never, {} as never);
    await expect(svc.get({ sub: 'staff' } as never, 'c9')).rejects.toThrow();
  });

  // A reseller belongs to a depot, so a depot-scoped caller must not read one outside
  // their own set — the row is loaded first, then checked.
  it('refuses a depot-scoped caller reading a reseller from another depot', async () => {
    const svc = new ResellerService(
      { findById: async () => ({ id: 'c1', homeDepotId: 'depot-other' }) } as never,
      {} as never,
    );
    await expect(
      svc.get({ sub: 's', role: 'KEPALA_DEPOT', depotId: 'depot-mine' } as never, 'c1'),
    ).rejects.toThrow();
  });

  it('returns the row for a caller inside the right depot', async () => {
    const row = { id: 'c1', homeDepotId: 'depot-mine' };
    const svc = new ResellerService({ findById: async () => row } as never, {} as never);
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
