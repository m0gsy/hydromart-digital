import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { Role } from '../../src/domain/customer/role.enum';
import { InternalAccountController } from '../../src/modules/auth/internal.controller';
import { ProvisionStaffDto } from '../../src/modules/auth/dto/internal.dto';

describe('InternalAccountController', () => {
  const account = {
    inviteStaff: jest.fn(),
    preRegisterCustomer: jest.fn(),
  };
  const controller = new InternalAccountController(account as never);

  beforeEach(() => jest.clearAllMocks());

  it('provisions a staff account and returns the public shape', async () => {
    account.inviteStaff.mockResolvedValue({
      id: 'cust-1',
      phone: '+628123456789',
      fullName: 'Budi',
      email: null,
      role: Role.DEPOT_OPERATOR,
      status: 'ACTIVE',
      avatarUrl: null,
      assignedDepotId: 'depot-1',
      createdAt: new Date(),
    });

    const result = await controller.provisionStaff({
      phone: '+628123456789',
      role: Role.DEPOT_OPERATOR as never,
      fullName: 'Budi',
      depotId: 'depot-1',
    });

    expect(account.inviteStaff).toHaveBeenCalledWith(
      '+628123456789',
      Role.DEPOT_OPERATOR,
      'Budi',
      'depot-1',
    );
    expect(result).toMatchObject({ id: 'cust-1', role: Role.DEPOT_OPERATOR });
  });

  it('passes a pre-register through untouched', async () => {
    account.preRegisterCustomer.mockResolvedValue({ customerId: 'cust-2', status: 'created' });

    await expect(
      controller.preRegisterCustomer({ phone: '081200001111', fullName: 'Siti' }),
    ).resolves.toEqual({ customerId: 'cust-2', status: 'created' });
    expect(account.preRegisterCustomer).toHaveBeenCalledWith('081200001111', 'Siti');
  });
});

describe('ProvisionStaffDto role allowlist', () => {
  async function errorsFor(role: string): Promise<string[]> {
    const dto = plainToInstance(ProvisionStaffDto, { phone: '+628123456789', role });
    return (await validate(dto)).map((e) => e.property);
  }

  it.each(['DEPOT_OPERATOR', 'DEPOT_MANAGER', 'DRIVER', 'FINANCE', 'HR', 'MARKETING'])(
    'accepts %s',
    async (role) => {
      expect(await errorsFor(role)).not.toContain('role');
    },
  );

  // The whole point of routing hr-service through this DTO: a CSV row must never be
  // a path to an office/superuser account.
  it.each(['HEAD_OFFICE', 'SUPER_ADMIN', 'CUSTOMER', 'FRANCHISE_OWNER', ''])(
    'rejects %s',
    async (role) => {
      expect(await errorsFor(role)).toContain('role');
    },
  );
});
