import { ForbiddenException } from '@nestjs/common';

import { AccountController } from '../../src/modules/auth/account.controller';
import { Role } from '../../src/domain/customer/role.enum';

describe('AccountController.listStaff depot-manager scope', () => {
  const ownDepot = '11111111-1111-4111-8111-111111111111';
  const otherDepot = '22222222-2222-4222-8222-222222222222';

  const account = {
    getProfile: jest.fn(),
    listStaff: jest.fn(),
  };
  const controller = new AccountController(account as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    account.getProfile.mockResolvedValue({ assignedDepotId: ownDepot });
    account.listStaff.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  });

  it('forces a depot manager directory read to their assigned depot', async () => {
    await controller.listStaff(
      { page: 1, limit: 20 },
      { sub: 'manager-1', role: Role.MANAGER, phone: '+62811111111' },
    );

    expect(account.listStaff).toHaveBeenCalledWith(1, 20, undefined, ownDepot, undefined);
  });

  it('rejects a depot manager requesting another depot', async () => {
    await expect(
      controller.listStaff(
        { depotId: otherDepot },
        { sub: 'manager-1', role: Role.MANAGER, phone: '+62811111111' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
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

describe('AccountController.importStaff', () => {
  const account = { importStaff: jest.fn() };
  const controller = new AccountController(account as never, {} as never);

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
  const controller = new AccountController(account as never, {} as never);

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
