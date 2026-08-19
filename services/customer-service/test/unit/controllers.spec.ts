import { ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { AddressController } from '../../src/modules/address.controller';
import { DepotCrmController } from '../../src/modules/depot-crm.controller';
import { FavoriteController } from '../../src/modules/favorite.controller';
import { HealthController } from '../../src/modules/health.controller';
import { InternalController } from '../../src/modules/internal.controller';
import { PaymentMethodController } from '../../src/modules/payment-method.controller';

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
  };
  const c = new AddressController(svc as never);
  beforeEach(() => jest.clearAllMocks());

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

  it('listDepotCustomers passes depotId + q through', async () => {
    svc.listDepotCustomers.mockResolvedValue(['row']);
    expect(await c.listDepotCustomers({ depotId: 'd1', q: 'ali' } as never)).toEqual(['row']);
    expect(svc.listDepotCustomers).toHaveBeenCalledWith('d1', 'ali');
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
  const resellers = { pricingFor: jest.fn() };
  const c = new InternalController(svc as never, imports as never, resellers as never, pdp as never);

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

  // §I: order-service resolving the counter buyer. The name defaults to the phone so a
  // cashier who typed only a number still creates a usable account rather than a blank one.
  it('resolveByPhone forwards the row, defaulting the name to the phone', async () => {
    imports.resolveByPhone.mockResolvedValue({ customerId: 'c9', status: 'created' });

    await expect(c.resolveByPhone({ phone: '0811', depotId: 'd1' })).resolves.toEqual({
      customerId: 'c9',
      status: 'created',
    });
    expect(imports.resolveByPhone).toHaveBeenCalledWith('0811', '0811', 'd1');

    await c.resolveByPhone({ phone: '0811', fullName: 'Budi', depotId: 'd1' });
    expect(imports.resolveByPhone).toHaveBeenLastCalledWith('0811', 'Budi', 'd1');
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
    svc.getCrmDashboard.mockImplementation(async (id: string) => ({ counts: { total: id.length } }));
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
    expect(out).toMatchObject({ status: 'ok', service: 'customer-service', checks: { database: 'up' } });
    expect(typeof out.timestamp).toBe('string');
  });

  it('throws 503 with a down report when the probe query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('no db'));
    await expect(c.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
