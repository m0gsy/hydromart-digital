import { randomUUID } from 'node:crypto';

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { Role } from '../../src/domain/customer/role.enum';
import { InternalAccountController } from '../../src/modules/auth/internal.controller';
import { LookupCustomerIdsDto, ProvisionStaffDto } from '../../src/modules/auth/dto/internal.dto';

describe('InternalAccountController', () => {
  const account = {
    inviteStaff: jest.fn(),
    preRegisterCustomer: jest.fn(),
    lookupByIds: jest.fn(),
  };
  const audit = { purgeOlderThan: jest.fn(async () => ({ deleted: 4 })) };
  const controller = new InternalAccountController(account as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('forwards the retention cutoff as a Date and returns the count', async () => {
    const out = await controller.purgeAuditLogs({ cutoff: '2026-01-01T00:00:00.000Z' } as never);
    expect(audit.purgeOlderThan).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00.000Z'));
    expect(out).toEqual({ deleted: 4 });
  });

  it('provisions a staff account and returns the public shape', async () => {
    account.inviteStaff.mockResolvedValue({
      id: 'cust-1',
      phone: '+628123456789',
      fullName: 'Budi',
      email: null,
      role: Role.KEPALA_DEPOT,
      status: 'ACTIVE',
      avatarUrl: null,
      assignedDepotId: 'depot-1',
      createdAt: new Date(),
    });

    const result = await controller.provisionStaff({
      phone: '+628123456789',
      role: Role.KEPALA_DEPOT as never,
      fullName: 'Budi',
      depotId: 'depot-1',
    });

    expect(account.inviteStaff).toHaveBeenCalledWith(
      '+628123456789',
      Role.KEPALA_DEPOT,
      'Budi',
      'depot-1',
    );
    expect(result).toMatchObject({ id: 'cust-1', role: Role.KEPALA_DEPOT });
  });

  it('passes a pre-register through untouched', async () => {
    account.preRegisterCustomer.mockResolvedValue({ customerId: 'cust-2', status: 'created' });

    await expect(
      controller.preRegisterCustomer({ phone: '081200001111', fullName: 'Siti' }),
    ).resolves.toEqual({ customerId: 'cust-2', status: 'created' });
    expect(account.preRegisterCustomer).toHaveBeenCalledWith('081200001111', 'Siti');
  });

  it('resolves a batch of ids to public profiles', async () => {
    account.lookupByIds.mockResolvedValue([
      { id: 'c1', phone: '+62811', fullName: 'Budi', email: null, role: Role.CUSTOMER, status: 'ACTIVE', avatarUrl: null },
    ]);

    const out = await controller.lookupByIds({ ids: ['c1', 'c2'] } as never);

    expect(account.lookupByIds).toHaveBeenCalledWith(['c1', 'c2']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'c1', fullName: 'Budi', phone: '+62811' });
  });
});

// The route exists so a depot directory can resolve names; the cap is what keeps one
// caller from asking for every account in the system in a single POST.
describe('LookupCustomerIdsDto', () => {
  const errorsFor = async (ids: unknown): Promise<string[]> =>
    (await validate(plainToInstance(LookupCustomerIdsDto, { ids }))).map((e) => e.property);

  it('accepts a list of uuids', async () => {
    expect(await errorsFor([randomUUID(), randomUUID()])).toEqual([]);
  });

  it('rejects a non-array, a non-uuid member, and more than 200 ids', async () => {
    expect(await errorsFor('c1')).toContain('ids');
    expect(await errorsFor(['not-a-uuid'])).toContain('ids');
    expect(await errorsFor(Array.from({ length: 201 }, () => randomUUID()))).toContain('ids');
  });
});

describe('ProvisionStaffDto role allowlist', () => {
  async function errorsFor(role: string): Promise<string[]> {
    const dto = plainToInstance(ProvisionStaffDto, { phone: '+628123456789', role });
    return (await validate(dto)).map((e) => e.property);
  }

  it.each(['STAFF_DEPOT', 'KEPALA_DEPOT'])('accepts %s', async (role) => {
    expect(await errorsFor(role)).not.toContain('role');
  });

  // The whole point of routing hr-service through this DTO: a CSV row must never be
  // a path to an office/superuser account — and since the depot chain grew supervision
  // levels, it must not mint those either. Everything above depot level is created by
  // hand in the staff console.
  it.each([
    'ASSISTANT_SUPERVISOR',
    'SUPERVISOR',
    'MANAGER',
    'DIREKTUR',
    'FINANCE',
    'HR',
    'MARKETING',
    'HEAD_OFFICE',
    'SUPER_ADMIN',
    'CUSTOMER',
    'FRANCHISE_OWNER',
    '',
  ])('rejects %s', async (role) => {
    expect(await errorsFor(role)).toContain('role');
  });
});
