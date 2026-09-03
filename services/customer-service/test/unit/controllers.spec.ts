import { ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { AddressController } from '../../src/modules/address.controller';
import { DepotCrmController } from '../../src/modules/depot-crm.controller';
import { FavoriteController } from '../../src/modules/favorite.controller';
import { HealthController } from '../../src/modules/health.controller';
import { InternalController } from '../../src/modules/internal.controller';
import { PaymentMethodController } from '../../src/modules/payment-method.controller';
import { ProfileController } from '../../src/modules/profile.controller';

// Thin HTTP controllers: assert each handler unwraps @CurrentUser/@Query/@Param
// and delegates to its service, returning the service result (or the documented wrapper).
const user: AuthenticatedUser = { sub: 'u1', role: Role.CUSTOMER, phone: null, depotId: null };

describe('AddressController', () => {
  const svc = {
    list: jest.fn(),
    create: jest.fn(),
    getOrThrow: jest.fn(),
    update: jest.fn(),
    setPrimary: jest.fn(),
    remove: jest.fn(),
    primary: jest.fn(),
  };
  const c = new AddressController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  // D10: the internal read order-service uses to find where a depot-created subscription
  // delivers. The customer id comes from the caller, not from a session — the guard is the
  // internal key, and the caller is a service acting on a depot operator's request.
  it('primary → addresses.primary(customerId), for the internal caller', async () => {
    svc.primary.mockResolvedValue({ id: 'a1' });
    await expect(c.primary('cust-9')).resolves.toEqual({ id: 'a1' });
    expect(svc.primary).toHaveBeenCalledWith('cust-9');
  });

  it('list → addresses.list(user.sub)', async () => {
    svc.list.mockResolvedValue(['a']);
    expect(await c.list(user)).toEqual(['a']);
    expect(svc.list).toHaveBeenCalledWith('u1');
  });
  it('create → addresses.create(user.sub, dto)', async () => {
    const dto = { label: 'Home' } as never;
    svc.create.mockResolvedValue({ id: 'a1' });
    expect(await c.create(user, dto)).toEqual({ id: 'a1' });
    expect(svc.create).toHaveBeenCalledWith('u1', dto);
  });
  it('get → addresses.getOrThrow(user.sub, id)', async () => {
    svc.getOrThrow.mockResolvedValue({ id: 'a1' });
    expect(await c.get(user, 'a1')).toEqual({ id: 'a1' });
    expect(svc.getOrThrow).toHaveBeenCalledWith('u1', 'a1');
  });
  it('update → addresses.update(user.sub, id, dto)', async () => {
    const dto = { label: 'Work' } as never;
    svc.update.mockResolvedValue({ id: 'a1', label: 'Work' });
    expect(await c.update(user, 'a1', dto)).toEqual({ id: 'a1', label: 'Work' });
    expect(svc.update).toHaveBeenCalledWith('u1', 'a1', dto);
  });
  it('setPrimary → addresses.setPrimary(user.sub, id)', async () => {
    svc.setPrimary.mockResolvedValue({ id: 'a1', isPrimary: true });
    expect(await c.setPrimary(user, 'a1')).toMatchObject({ isPrimary: true });
    expect(svc.setPrimary).toHaveBeenCalledWith('u1', 'a1');
  });
  it('remove → addresses.remove(user.sub, id) and resolves void', async () => {
    svc.remove.mockResolvedValue(undefined);
    await expect(c.remove(user, 'a1')).resolves.toBeUndefined();
    expect(svc.remove).toHaveBeenCalledWith('u1', 'a1');
  });
});

describe('FavoriteController', () => {
  const svc = { list: jest.fn(), add: jest.fn(), remove: jest.fn() };
  const c = new FavoriteController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  it('list wraps the id array as { productIds }', async () => {
    svc.list.mockResolvedValue(['p1', 'p2']);
    expect(await c.list(user)).toEqual({ productIds: ['p1', 'p2'] });
    expect(svc.list).toHaveBeenCalledWith('u1');
  });
  it('add wraps the updated id array as { productIds }', async () => {
    svc.add.mockResolvedValue(['p1']);
    expect(await c.add(user, { productId: 'p1' } as never)).toEqual({ productIds: ['p1'] });
    expect(svc.add).toHaveBeenCalledWith('u1', 'p1');
  });
  it('remove delegates and resolves void', async () => {
    svc.remove.mockResolvedValue(undefined);
    await expect(c.remove(user, 'p1')).resolves.toBeUndefined();
    expect(svc.remove).toHaveBeenCalledWith('u1', 'p1');
  });
});

describe('PaymentMethodController', () => {
  const svc = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setDefault: jest.fn(),
    remove: jest.fn(),
  };
  const c = new PaymentMethodController(svc as never);
  beforeEach(() => jest.clearAllMocks());

  it('list → methods.list(user.sub)', async () => {
    svc.list.mockResolvedValue(['m']);
    expect(await c.list(user)).toEqual(['m']);
    expect(svc.list).toHaveBeenCalledWith('u1');
  });
  it('create → methods.create(user.sub, dto)', async () => {
    const dto = { type: 'CASH' } as never;
    svc.create.mockResolvedValue({ id: 'm1' });
    expect(await c.create(user, dto)).toEqual({ id: 'm1' });
    expect(svc.create).toHaveBeenCalledWith('u1', dto);
  });
  it('update → methods.update(user.sub, id, dto)', async () => {
    const dto = { label: 'x' } as never;
    svc.update.mockResolvedValue({ id: 'm1' });
    expect(await c.update(user, 'm1', dto)).toEqual({ id: 'm1' });
    expect(svc.update).toHaveBeenCalledWith('u1', 'm1', dto);
  });
  it('setDefault → methods.setDefault(user.sub, id)', async () => {
    svc.setDefault.mockResolvedValue({ id: 'm1', isDefault: true });
    expect(await c.setDefault(user, 'm1')).toMatchObject({ isDefault: true });
    expect(svc.setDefault).toHaveBeenCalledWith('u1', 'm1');
  });
  it('remove → methods.remove(user.sub, id) and resolves void', async () => {
    svc.remove.mockResolvedValue(undefined);
    await expect(c.remove(user, 'm1')).resolves.toBeUndefined();
    expect(svc.remove).toHaveBeenCalledWith('u1', 'm1');
  });
});

describe('DepotCrmController', () => {
  const svc = {
    listDepotCustomers: jest.fn(),
    getCrmDashboard: jest.fn(),
    getDepotDetail: jest.fn(),
  };
  const imports = { importCustomers: jest.fn() };
  const c = new DepotCrmController(svc as never, imports as never);
  beforeEach(() => jest.clearAllMocks());

  it('import hands the rows and depot to the import service', async () => {
    imports.importCustomers.mockResolvedValue({ created: 1, skipped: 0, failed: 0, results: [] });
    const rows = [{ fullName: 'Siti', phone: '0812' }];
    const user = { sub: 'op-1' } as never;

    await c.import({ depotId: 'd1', rows } as never, user);

    expect(imports.importCustomers).toHaveBeenCalledWith(user, 'd1', rows);
  });

  it('listDepotCustomers passes depotId + q + the page bounds through', async () => {
    svc.listDepotCustomers.mockResolvedValue(['row']);
    expect(await c.listDepotCustomers({ depotId: 'd1', q: 'ali' } as never)).toEqual(['row']);
    // W9: page and limit are part of the call now. `undefined` here is the DTO's default
    // arriving unset — asserted rather than elided, because a controller that silently
    // dropped them would restore the unbounded read this endpoint was fixed for.
    expect(svc.listDepotCustomers).toHaveBeenCalledWith('d1', 'ali', undefined, undefined);
  });
  it('crmDashboard passes depotId through', async () => {
    svc.getCrmDashboard.mockResolvedValue({ counts: {} });
    expect(await c.crmDashboard({ depotId: 'd1' } as never)).toEqual({ counts: {} });
    expect(svc.getCrmDashboard).toHaveBeenCalledWith('d1');
  });
  it('getDepotDetail passes id + depotId through', async () => {
    svc.getDepotDetail.mockResolvedValue({ profile: {} });
    expect(await c.getDepotDetail('c1', { depotId: 'd1' } as never)).toEqual({ profile: {} });
    expect(svc.getDepotDetail).toHaveBeenCalledWith('c1', 'd1');
  });
});

describe('InternalController', () => {
  const svc = { listCustomerIdsByDepot: jest.fn(), getCrmDashboard: jest.fn() };
  const pdp = { exportFor: jest.fn(), anonymise: jest.fn() };
  const imports = { resolveByPhone: jest.fn() };
  const resellers = { pricingFor: jest.fn(), applyScheduled: jest.fn() };
  const c = new InternalController(
    svc as never,
    imports as never,
    resellers as never,
    pdp as never,
  );

  /*
   * A6/A9. The counter read used to go through `/resellers/:id` on the CASHIER's bearer,
   * and `resellerView` lists neither KEPALA_DEPOT nor STAFF_DEPOT — so it answered 403 and
   * every agen at a till was charged retail. This route carries no depot check at all; the
   * depot question rides out as `homeDepotId` for order-service to answer.
   */
  it('resellerPricing answers pricing plus the home depot, with no depot check', async () => {
    resellers.pricingFor.mockResolvedValue({
      customerId: 'c1',
      homeDepotId: 'd-home',
      active: true,
      discountPct: 12,
      flatGallonPriceIdr: 5000,
      note: 'ignored',
    });

    await expect(c.resellerPricing('c1')).resolves.toEqual({
      active: true,
      discountPct: 12,
      flatGallonPriceIdr: 5000,
      homeDepotId: 'd-home',
    });
    expect(resellers.pricingFor).toHaveBeenCalledWith('c1');
  });

  /**
   * K4.2. The scheduler is the caller here, and it reads the `ok` field off this body to
   * decide whether the round was alive (J7). Passing it straight through is the point.
   */
  it('hands the scheduled-change sweep result through untouched, ok flag included', async () => {
    const sweep = { ok: false, due: 3, applied: 0 };
    resellers.applyScheduled.mockResolvedValue(sweep);

    await expect(c.applyScheduledResellerChanges()).resolves.toEqual(sweep);
    expect(resellers.applyScheduled).toHaveBeenCalledWith();
  });

  /**
   * C9: this asserted the DEFAULT, and the default was the bug — an account created with
   * `fullName` set to the phone number, standing in as a person's name on every screen
   * that lists customers, for somebody who never verified and never consented.
   */
  it('resolveByPhone forwards no name when the caller sent none', async () => {
    await c.resolveByPhone({ phone: '0811', depotId: 'd1' } as never);
    expect(imports.resolveByPhone).toHaveBeenCalledWith('0811', null, 'd1');
  });

  it('resolveByPhone forwards the name when there is one', async () => {
    await c.resolveByPhone({ phone: '0811', fullName: 'Budi', depotId: 'd1' } as never);
    expect(imports.resolveByPhone).toHaveBeenCalledWith('0811', 'Budi', 'd1');
  });
  beforeEach(() => jest.clearAllMocks());

  it('customerIdsByDepot wraps the id array as { customerIds }', async () => {
    svc.listCustomerIdsByDepot.mockResolvedValue(['c1', 'c2']);
    expect(await c.customerIdsByDepot('d1')).toEqual({ customerIds: ['c1', 'c2'] });
    expect(svc.listCustomerIdsByDepot).toHaveBeenCalledWith('d1');
  });
  it('crmSummary delegates to getCrmDashboard', async () => {
    svc.getCrmDashboard.mockResolvedValue({ counts: {} });
    expect(await c.crmSummary('d1')).toEqual({ counts: {} });
    expect(svc.getCrmDashboard).toHaveBeenCalledWith('d1');
  });
  it('crmSummaries answers every depot in one request, each row carrying its depotId', async () => {
    svc.getCrmDashboard.mockImplementation(async (id: string) => ({
      counts: { total: id.length },
    }));
    expect(await c.crmSummaries('d1, d2 ,')).toEqual([
      { depotId: 'd1', counts: { total: 2 } },
      { depotId: 'd2', counts: { total: 2 } },
    ]);
    expect(svc.getCrmDashboard).toHaveBeenCalledTimes(2);
  });
  it('crmSummaries asks nothing for an empty or missing depot list', async () => {
    expect(await c.crmSummaries('')).toEqual([]);
    expect(await c.crmSummaries(undefined as unknown as string)).toEqual([]);
    expect(svc.getCrmDashboard).not.toHaveBeenCalled();
  });
  it('pdpExport hands the whole customer blob back (item 13)', async () => {
    pdp.exportFor.mockResolvedValue({ profile: {}, addresses: [] });
    expect(await c.pdpExport('c1')).toEqual({ profile: {}, addresses: [] });
    expect(pdp.exportFor).toHaveBeenCalledWith('c1');
  });
  it('pdpAnonymise forwards the customerId from the body', async () => {
    pdp.anonymise.mockResolvedValue(undefined);
    await c.pdpAnonymise({ customerId: 'c1' } as never);
    expect(pdp.anonymise).toHaveBeenCalledWith('c1');
  });
});

describe('HealthController', () => {
  const prisma = { $queryRaw: jest.fn() };
  const c = new HealthController(prisma as never);
  beforeEach(() => jest.clearAllMocks());

  it('reports database up when the probe query succeeds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    const out = await c.check();
    expect(out).toMatchObject({
      status: 'ok',
      service: 'customer-service',
      checks: { database: 'up' },
    });
    expect(typeof out.timestamp).toBe('string');
  });

  it('throws 503 with a down report when the probe query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('no db'));
    await expect(c.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

/**
 * F1: the sending service can finally ask whether a customer still wants push. Internal
 * key, not a bearer — a notification is fired by an order webhook, a cron or a courier's
 * proof of delivery, and none of those hold the customer's token.
 */
// I5: the customer's own deposit read. The id comes off the verified session, never off
// the request — one customer must not be able to read another's deposit by asking.
describe('ProfileController · my gallon deposit (I5)', () => {
  const profiles = { myGallonDeposits: jest.fn() };
  const c = new ProfileController(profiles as never, {} as never);

  it('scopes the read to the caller and returns what the service answered', async () => {
    const rows = [
      { depotId: 'd1', depotName: 'Depot Cikini', gallonsOnLoan: 2, depositHeldIdr: 40000 },
    ];
    profiles.myGallonDeposits.mockResolvedValue(rows);
    await expect(c.myGallonDeposits(user)).resolves.toEqual(rows);
    expect(profiles.myGallonDeposits).toHaveBeenCalledWith('u1');
  });

  it('passes null through, so the screen can say "not connected"', async () => {
    profiles.myGallonDeposits.mockResolvedValue(null);
    await expect(c.myGallonDeposits(user)).resolves.toBeNull();
  });
});

/*
 * PAR-05. FR-091 was built, tested and idempotent per customer per year — and the only
 * route to it was @Roles(SUPER_ADMIN), i.e. it needed a human's JWT. The scheduler
 * authenticates with `x-internal-key` and has none, so no birthday point has ever been
 * granted in production and nothing complained: there is no screen whose absence is felt.
 *
 * The verdict matters as much as the door. sweep.sh greps `ok` because a 200 is a
 * statement about the transport, not about the round (J7).
 */
describe('ProfileController · birthday sweep for the scheduler (PAR-05)', () => {
  const profiles = { runBirthdayRewards: jest.fn() };
  const c = new ProfileController(profiles as never, {} as never);

  beforeEach(() => profiles.runBirthdayRewards.mockReset());

  it('sweeps with no JWT — the adapter carries the internal key', async () => {
    profiles.runBirthdayRewards.mockResolvedValue({
      date: '2026-05-17',
      candidates: 3,
      granted: 3,
      failed: 0,
      disabled: false,
    });
    await expect(c.runBirthdayRewardsInternal()).resolves.toMatchObject({ granted: 3, ok: true });
    expect(profiles.runBirthdayRewards).toHaveBeenCalledWith('');
  });

  it('is ok on a day with no birthdays — nothing due is a working sweep', async () => {
    profiles.runBirthdayRewards.mockResolvedValue({
      date: '2026-05-17',
      candidates: 0,
      granted: 0,
      failed: 0,
      disabled: false,
    });
    await expect(c.runBirthdayRewardsInternal()).resolves.toMatchObject({ ok: true });
  });

  // Partial failure stays ok on purpose: a scheduler pinned to unhealthy by one bad row
  // reports an outage no more usefully than one that is always green.
  it('is still ok when one grant of many failed', async () => {
    profiles.runBirthdayRewards.mockResolvedValue({
      date: '2026-05-17',
      candidates: 4,
      granted: 3,
      failed: 1,
      disabled: false,
    });
    await expect(c.runBirthdayRewardsInternal()).resolves.toMatchObject({ ok: true });
  });

  it('is NOT ok when every candidate failed', async () => {
    profiles.runBirthdayRewards.mockResolvedValue({
      date: '2026-05-17',
      candidates: 4,
      granted: 0,
      failed: 4,
      disabled: false,
    });
    await expect(c.runBirthdayRewardsInternal()).resolves.toMatchObject({ ok: false });
  });

  // No LOYALTY_SERVICE_URL: the round could not do its job and every candidate went
  // un-stamped. That is a dead sweep, not a quiet one.
  it('is NOT ok when the sweep is disabled by missing configuration', async () => {
    profiles.runBirthdayRewards.mockResolvedValue({
      date: '2026-05-17',
      candidates: 3,
      granted: 0,
      failed: 0,
      disabled: true,
    });
    await expect(c.runBirthdayRewardsInternal()).resolves.toMatchObject({ ok: false });
  });
});

describe('ProfileController · internal notification preferences', () => {
  const profiles = { findSegment: jest.fn() };
  const notifications = { get: jest.fn(), update: jest.fn() };
  const c = new ProfileController(profiles as never, notifications as never);

  beforeEach(() => {
    notifications.get.mockReset();
  });

  it('answers with the same defaults-applied record the customer’s own route returns', async () => {
    const record = { customerId: 'c1', push: false, email: true, whatsapp: true, categories: {} };
    notifications.get.mockResolvedValue(record);

    await expect(c.internalNotificationPrefs('c1')).resolves.toEqual(record);
    expect(notifications.get).toHaveBeenCalledWith('c1');
  });

  it('asks about the customer it was given, not the caller', async () => {
    notifications.get.mockResolvedValue({
      customerId: 'c2',
      push: true,
      email: true,
      whatsapp: true,
      categories: {},
    });
    await c.internalNotificationPrefs('c2');
    expect(notifications.get).toHaveBeenCalledWith('c2');
  });
});
