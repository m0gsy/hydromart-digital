import { ForbiddenException } from '@nestjs/common';

import { AccountController } from '../../src/modules/auth/account.controller';
import { AccountService } from '../../src/application/services/account.service';
import { Role } from '../../src/domain/customer/role.enum';

describe('AccountController.listStaff depot-manager scope', () => {
  const ownDepot = '11111111-1111-4111-8111-111111111111';
  const otherDepot = '22222222-2222-4222-8222-222222222222';

  const account = {
    getProfile: jest.fn(),
    // S3: the depot-scoping rule moved to AccountService (two controllers need it). Bound

    // to this mock so these cases still exercise the real rule with a mocked profile read.

    resolveScopedDepot: (u: never, d?: string) =>

      AccountService.prototype.resolveScopedDepot.call(account, u, d),
    listStaff: jest.fn(),
  };
  const controller = new AccountController(account as never, {} as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    account.getProfile.mockResolvedValue({ assignedDepotId: ownDepot });
    account.listStaff.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  });

  // A manager's depots come from the hierarchy, not from this service's assignedDepotId
  // column — DepotScopeGuard resolves them into `depotIds` for the request.
  it('forces a depot manager directory read to the one depot they hold', async () => {
    await controller.listStaff(
      { page: 1, limit: 20 },
      { sub: 'manager-1', role: Role.MANAGER, phone: '+62811111111', depotIds: [ownDepot] },
    );

    expect(account.listStaff).toHaveBeenCalledWith(1, 20, undefined, ownDepot, undefined);
  });

  it('rejects a depot manager requesting a depot outside their scope', async () => {
    await expect(
      controller.listStaff(
        { depotId: otherDepot },
        { sub: 'manager-1', role: Role.MANAGER, phone: '+62811111111', depotIds: [ownDepot] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a manager whose scope resolved to nothing, rather than reading every depot', async () => {
    await expect(
      controller.listStaff(
        { page: 1, limit: 20 },
        { sub: 'manager-1', role: Role.MANAGER, phone: '+62811111111', depotIds: [] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listStaff).not.toHaveBeenCalled();
  });

  it('makes a multi-depot manager name the depot instead of widening to all of them', async () => {
    await expect(
      controller.listStaff(
        { page: 1, limit: 20 },
        { sub: 'manager-1', role: Role.MANAGER, phone: '+62811111111', depotIds: [ownDepot, otherDepot] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await controller.listStaff(
      { depotId: otherDepot },
      { sub: 'manager-1', role: Role.MANAGER, phone: '+62811111111', depotIds: [ownDepot, otherDepot] },
    );
    expect(account.listStaff).toHaveBeenCalledWith(1, 20, undefined, otherDepot, undefined);
  });

  it('keeps HQ staff-directory filters unchanged', async () => {
    await controller.listStaff(
      { depotId: otherDepot, role: Role.STAFF_DEPOT },
      { sub: 'hq-1', role: Role.SUPER_ADMIN, phone: '+62822222222' },
    );

    expect(account.getProfile).not.toHaveBeenCalled();
    expect(account.listStaff).toHaveBeenCalledWith(1, 20, Role.STAFF_DEPOT, otherDepot, undefined);
  });
});

// The dispatch roster used to be network-wide: a dispatcher at depot A could assign a
// courier who belongs to depot B, and only the delivery would notice.
describe('AccountController.listDrivers depot scope', () => {
  const ownDepot = '11111111-1111-4111-8111-111111111111';
  const otherDepot = '22222222-2222-4222-8222-222222222222';

  // The real scoping rule, bound to this mock — it lives on AccountService now (two
  // controllers need it), and these cases are about the rule, not about the delegation.
  const account = {
    getProfile: jest.fn(),
    listDrivers: jest.fn(),
    resolveScopedDepot: (u: never, d?: string) =>
      AccountService.prototype.resolveScopedDepot.call(account, u, d),
  };
  const controller = new AccountController(account as never, {} as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    account.getProfile.mockResolvedValue({ assignedDepotId: ownDepot });
    account.listDrivers.mockResolvedValue([]);
  });

  it('scopes a depot-locked caller to their own depot', async () => {
    await controller.listDrivers({}, { sub: 'kd-1', role: Role.KEPALA_DEPOT, phone: '+62811' } as never);
    expect(account.listDrivers).toHaveBeenCalledWith(ownDepot);
  });

  // Refused rather than silently rewritten, exactly as the staff directory does it: a
  // request for another depot's couriers is a mistake worth telling somebody about.
  it('refuses a depot-locked caller asking for another depot', async () => {
    await expect(
      controller.listDrivers(
        { depotId: otherDepot },
        { sub: 'kd-1', role: Role.KEPALA_DEPOT, phone: '+62811' } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listDrivers).not.toHaveBeenCalled();
  });

  it('refuses a depot-locked caller with no depot at all — never falls back to all', async () => {
    account.getProfile.mockResolvedValue({ assignedDepotId: null });
    await expect(
      controller.listDrivers(
        {},
        { sub: 'kd-2', role: Role.KEPALA_DEPOT, phone: '+62811' } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listDrivers).not.toHaveBeenCalled();
  });

  it('scopes a depot manager to the depot they hold, as the staff directory does', async () => {
    await controller.listDrivers(
      {},
      { sub: 'mgr-1', role: Role.MANAGER, phone: '+62811', depotIds: [ownDepot] } as never,
    );
    expect(account.listDrivers).toHaveBeenCalledWith(ownDepot);
  });

  it('lets HQ read one depot, or the whole network when it asks for neither', async () => {
    await controller.listDrivers(
      { depotId: otherDepot },
      { sub: 'hq-1', role: Role.SUPER_ADMIN, phone: '+62822' } as never,
    );
    expect(account.listDrivers).toHaveBeenCalledWith(otherDepot);

    await controller.listDrivers({}, { sub: 'hq-1', role: Role.SUPER_ADMIN, phone: '+62822' } as never);
    expect(account.listDrivers).toHaveBeenLastCalledWith(undefined);
  });
});

describe('AccountController.importStaff', () => {
  const account = { importStaff: jest.fn() };
  const controller = new AccountController(account as never, {} as never, {} as never);

  it('hands the rows to the service and returns the summary untouched', async () => {
    const summary = { created: 1, updated: 0, skipped: 0, failed: 0, results: [{ row: 1, status: 'created' }] };
    account.importStaff.mockResolvedValue(summary);

    const rows = [{ phone: '+628990005001', role: Role.HEAD_OFFICE }];
    await expect(controller.importStaff({ rows } as never)).resolves.toBe(summary);
    expect(account.importStaff).toHaveBeenCalledWith(rows);
  });
});

describe('AccountController.lookupByIds', () => {
  const account = { lookupByIds: jest.fn() };
  const controller = new AccountController(account as never, {} as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    account.lookupByIds.mockResolvedValue([{ id: 'a', fullName: 'Agus' }]);
  });

  it('splits/trims the comma list and maps the result to DTOs', async () => {
    const result = await controller.lookupByIds(' a , b ');
    expect(account.lookupByIds).toHaveBeenCalledWith(['a', 'b']);
    expect(result).toEqual([{ id: 'a', fullName: 'Agus' }]);
  });

  it('passes an empty list when the query is absent', async () => {
    account.lookupByIds.mockResolvedValue([]);
    await controller.lookupByIds(undefined);
    expect(account.lookupByIds).toHaveBeenCalledWith(['']);
  });
});
