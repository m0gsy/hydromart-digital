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
      { sub: 'manager-1', role: Role.DEPOT_MANAGER, phone: '+62811111111' },
    );

    expect(account.listStaff).toHaveBeenCalledWith(1, 20, undefined, ownDepot);
  });

  it('rejects a depot manager requesting another depot', async () => {
    await expect(
      controller.listStaff(
        { depotId: otherDepot },
        { sub: 'manager-1', role: Role.DEPOT_MANAGER, phone: '+62811111111' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps HQ staff-directory filters unchanged', async () => {
    await controller.listStaff(
      { depotId: otherDepot, role: Role.DRIVER },
      { sub: 'hq-1', role: Role.SUPER_ADMIN, phone: '+62822222222' },
    );

    expect(account.getProfile).not.toHaveBeenCalled();
    expect(account.listStaff).toHaveBeenCalledWith(1, 20, Role.DRIVER, otherDepot);
  });
});
