import { ForbiddenException } from '@nestjs/common';

import { AccountController } from '../../src/modules/auth/account.controller';
import { AccountService } from '../../src/application/services/account.service';
import { Role } from '../../src/domain/customer/role.enum';

/** K1.4: the controller takes a PhoneChangeService; these specs exercise other routes. */
function phoneChangeStub() {
  return { request: jest.fn(), confirm: jest.fn() } as never;
}

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
  const controller = new AccountController(
    account as never,
    {} as never,
    {} as never,
    phoneChangeStub(),
  );

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

  // FINANCE reads this list to name the franchise owner it releases money to — nothing more.
  // `staffDirectoryFinance` opened the route to them, so the controller is what keeps it from
  // becoming a staff roster for the people who run the books.
  it('lets FINANCE read franchise owners only, and refuses any other role filter', async () => {
    const finance = { sub: 'fin-1', role: Role.FINANCE, phone: '+62833333333' };

    await controller.listStaff({ page: 1, limit: 20, role: Role.FRANCHISE_OWNER }, finance);
    expect(account.listStaff).toHaveBeenCalledWith(1, 20, Role.FRANCHISE_OWNER, undefined, undefined);

    jest.clearAllMocks();
    await expect(controller.listStaff({ page: 1, limit: 20 }, finance)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.listStaff({ page: 1, limit: 20, role: Role.MANAGER }, finance),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listStaff).not.toHaveBeenCalled();
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

  // The fail-closed half: `depotIds` absent means DepotScopeGuard did not run on this route.
  // Reading `requested` there would hand a manager the whole network the day someone forgets
  // to register the guard, so it must refuse exactly like an empty scope does.
  it('refuses a manager whose scope was never resolved at all', async () => {
    await expect(
      controller.listStaff(
        { page: 1, limit: 20 },
        { sub: 'manager-1', role: Role.MANAGER, phone: '+62811111111' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listStaff).not.toHaveBeenCalled();
  });

  it('makes a multi-depot manager name the depot instead of widening to all of them', async () => {
    await expect(
      controller.listStaff(
        { page: 1, limit: 20 },
        {
          sub: 'manager-1',
          role: Role.MANAGER,
          phone: '+62811111111',
          depotIds: [ownDepot, otherDepot],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await controller.listStaff(
      { depotId: otherDepot },
      {
        sub: 'manager-1',
        role: Role.MANAGER,
        phone: '+62811111111',
        depotIds: [ownDepot, otherDepot],
      },
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
  const controller = new AccountController(
    account as never,
    {} as never,
    {} as never,
    phoneChangeStub(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    account.getProfile.mockResolvedValue({ assignedDepotId: ownDepot });
    account.listDrivers.mockResolvedValue([]);
  });

  it('scopes a depot-locked caller to their own depot', async () => {
    await controller.listDrivers({}, {
      sub: 'kd-1',
      role: Role.KEPALA_DEPOT,
      phone: '+62811',
    } as never);
    expect(account.listDrivers).toHaveBeenCalledWith(ownDepot);
  });

  // Refused rather than silently rewritten, exactly as the staff directory does it: a
  // request for another depot's couriers is a mistake worth telling somebody about.
  it('refuses a depot-locked caller asking for another depot', async () => {
    await expect(
      controller.listDrivers({ depotId: otherDepot }, {
        sub: 'kd-1',
        role: Role.KEPALA_DEPOT,
        phone: '+62811',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listDrivers).not.toHaveBeenCalled();
  });

  it('refuses a depot-locked caller with no depot at all — never falls back to all', async () => {
    account.getProfile.mockResolvedValue({ assignedDepotId: null });
    await expect(
      controller.listDrivers({}, {
        sub: 'kd-2',
        role: Role.KEPALA_DEPOT,
        phone: '+62811',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listDrivers).not.toHaveBeenCalled();
  });

  it('scopes a depot manager to the depot they hold, as the staff directory does', async () => {
    await controller.listDrivers({}, {
      sub: 'mgr-1',
      role: Role.MANAGER,
      phone: '+62811',
      depotIds: [ownDepot],
    } as never);
    expect(account.listDrivers).toHaveBeenCalledWith(ownDepot);
  });

  it('lets HQ read one depot, or the whole network when it asks for neither', async () => {
    await controller.listDrivers({ depotId: otherDepot }, {
      sub: 'hq-1',
      role: Role.SUPER_ADMIN,
      phone: '+62822',
    } as never);
    expect(account.listDrivers).toHaveBeenCalledWith(otherDepot);

    await controller.listDrivers({}, {
      sub: 'hq-1',
      role: Role.SUPER_ADMIN,
      phone: '+62822',
    } as never);
    expect(account.listDrivers).toHaveBeenLastCalledWith(undefined);
  });
});

describe('AccountController.importStaff', () => {
  const account = { importStaff: jest.fn() };
  const controller = new AccountController(
    account as never,
    {} as never,
    {} as never,
    phoneChangeStub(),
  );

  it('hands the rows to the service and returns the summary untouched', async () => {
    const summary = {
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      results: [{ row: 1, status: 'created' }],
    };
    account.importStaff.mockResolvedValue(summary);

    const rows = [{ phone: '+628990005001', role: Role.HEAD_OFFICE }];
    const hq = { sub: 'hq-1', role: Role.HEAD_OFFICE } as never;
    await expect(controller.importStaff({ rows } as never, hq)).resolves.toBe(summary);
    // The caller's role rides along: the write path decides what they may grant (AUTHZ-1).
    expect(account.importStaff).toHaveBeenCalledWith(rows, Role.HEAD_OFFICE);
  });
});

describe('AccountController.lookupByIds', () => {
  const account = { lookupByIds: jest.fn() };
  const controller = new AccountController(
    account as never,
    {} as never,
    {} as never,
    phoneChangeStub(),
  );

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

/**
 * K1.4. The controller's whole job on these two routes is to keep the request body and the
 * proved destination apart. The confirm DTO carries no phone, and this is where that stops
 * being an accident of the DTO.
 */
describe('AccountController phone change (K1.4)', () => {
  const phoneChange = { request: jest.fn(), confirm: jest.fn() };
  const controller = new AccountController(
    {} as never,
    {} as never,
    {} as never,
    phoneChange as never,
  );
  const user = { sub: 'cust-1' } as never;
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as never;

  beforeEach(() => {
    phoneChange.request.mockReset();
    phoneChange.confirm.mockReset();
  });

  it('passes the new number and the request context to the request step', async () => {
    phoneChange.request.mockResolvedValue({
      phoneMasked: '+6289***210',
      expiresInSeconds: 300,
      resendCooldownSeconds: 60,
    });

    const out = await controller.requestPhoneChange(user, { phone: '089876543210' }, req);

    expect(out.phoneMasked).toBe('+6289***210');
    expect(phoneChange.request).toHaveBeenCalledWith(
      'cust-1',
      '089876543210',
      expect.objectContaining({ userAgent: 'jest' }),
    );
  });

  it('hands the confirm step the code and NOTHING that could name a destination', async () => {
    phoneChange.confirm.mockResolvedValue({
      id: 'cust-1',
      phone: '+6289876543210',
      role: 'CUSTOMER',
    });

    const out = await controller.confirmPhoneChange(user, { code: '123456' }, req);

    expect(out.phone).toBe('+6289876543210');
    expect(phoneChange.confirm).toHaveBeenCalledWith(
      'cust-1',
      '123456',
      expect.objectContaining({ userAgent: 'jest' }),
    );
  });
});

/*
 * Owner decision 2026-10-20: SUPERVISOR and ASSISTANT_SUPERVISOR may read the courier list, because
 * they dispatch (`tracking`) and could not pick a courier without it. They are depot-RESOLVED
 * roles like MANAGER, so the roster read has to narrow them the way it narrows a manager. Before
 * this, `resolveScopedDepot` only knew MANAGER and handed every other role whatever it asked for:
 * granting the read alone would have let a supervisor list every depot's couriers by omitting
 * `depotId`.
 */
describe.each([Role.SUPERVISOR, Role.ASSISTANT_SUPERVISOR])('GET /auth/drivers for %s', (role) => {
  const ownDepot = '11111111-1111-4111-8111-111111111111';
  const otherDepot = '22222222-2222-4222-8222-222222222222';
  const phone = '+62811111111';

  const account = {
    getProfile: jest.fn(),
    resolveScopedDepot: (u: never, d?: string) =>
      AccountService.prototype.resolveScopedDepot.call(account, u, d),
    listDrivers: jest.fn(),
  };
  const controller = new AccountController(
    account as never,
    {} as never,
    {} as never,
    phoneChangeStub(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    account.listDrivers.mockResolvedValue([]);
  });

  it('reads the one depot in scope when none is named', async () => {
    await controller.listDrivers({}, { sub: 's-1', role, phone, depotIds: [ownDepot] });

    expect(account.listDrivers).toHaveBeenCalledWith(ownDepot);
  });

  it('reads a named depot that is inside the scope', async () => {
    await controller.listDrivers(
      { depotId: otherDepot },
      { sub: 's-1', role, phone, depotIds: [ownDepot, otherDepot] },
    );

    expect(account.listDrivers).toHaveBeenCalledWith(otherDepot);
  });

  it('refuses a depot outside the scope instead of rewriting it', async () => {
    await expect(
      controller.listDrivers({ depotId: otherDepot }, { sub: 's-1', role, phone, depotIds: [ownDepot] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listDrivers).not.toHaveBeenCalled();
  });

  it('makes a multi-depot caller name the depot rather than widening to every one of them', async () => {
    await expect(
      controller.listDrivers({}, { sub: 's-1', role, phone, depotIds: [ownDepot, otherDepot] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(account.listDrivers).not.toHaveBeenCalled();
  });

  it('refuses an empty or never-resolved scope, rather than reading every depot', async () => {
    await expect(
      controller.listDrivers({}, { sub: 's-1', role, phone, depotIds: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.listDrivers({}, { sub: 's-1', role, phone })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(account.listDrivers).not.toHaveBeenCalled();
  });
});
