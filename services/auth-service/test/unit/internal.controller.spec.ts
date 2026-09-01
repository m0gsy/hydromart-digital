import { randomUUID } from 'node:crypto';

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { Role } from '../../src/domain/customer/role.enum';
import { InternalAccountController } from '../../src/modules/auth/internal.controller';
import {
  LookupCustomerIdsDto,
  ProvisionManagedStaffDto,
  ProvisionStaffDto,
} from '../../src/modules/auth/dto/internal.dto';

describe('InternalAccountController', () => {
  const account = {
    inviteStaff: jest.fn(),
    preRegisterCustomer: jest.fn(),
    lookupByIds: jest.fn(),
    updateStaffProfileInternal: jest.fn(),
    setStaffActiveInternal: jest.fn(),
  };
  const audit = { purgeOlderThan: jest.fn(async () => ({ deleted: 4 })) };
  const controller = new InternalAccountController(account as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  /*
   * The route hr-service calls to disable a login when somebody leaves. It had no test at
   * all, which for a door that switches off access is the wrong thing to be missing.
   */
  it('setStaffActive forwards the id and flag, and returns the public customer', async () => {
    const staff = {
      id: 'c1',
      phone: '+628123456789',
      fullName: 'Budi',
      role: Role.MANAGER,
      status: 'ACTIVE',
    };
    account.setStaffActiveInternal.mockResolvedValue(staff as never);
    const res = await controller.setStaffActive({ customerId: 'c1', active: false } as never);
    expect(account.setStaffActiveInternal).toHaveBeenCalledWith('c1', false);
    expect(res).toMatchObject({ id: 'c1', role: Role.MANAGER });
  });

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

  it('provisions an HR-managed account through the same invite path', async () => {
    account.inviteStaff.mockResolvedValue({
      id: 'cust-9',
      phone: '+628123450000',
      fullName: 'Rina',
      email: null,
      role: Role.SUPERVISOR,
      status: 'ACTIVE',
      avatarUrl: null,
      assignedDepotId: null,
      createdAt: new Date(),
    });

    const result = await controller.provisionManagedStaff({
      phone: '+628123450000',
      role: Role.SUPERVISOR as never,
      fullName: 'Rina',
    });

    expect(account.inviteStaff).toHaveBeenCalledWith(
      '+628123450000',
      Role.SUPERVISOR,
      'Rina',
      undefined,
    );
    expect(result).toMatchObject({ id: 'cust-9', role: Role.SUPERVISOR });
  });

  it('passes a pre-register through untouched', async () => {
    account.preRegisterCustomer.mockResolvedValue({ customerId: 'cust-2', status: 'created' });

    await expect(
      controller.preRegisterCustomer({ phone: '081200001111', fullName: 'Siti' }),
    ).resolves.toEqual({ customerId: 'cust-2', status: 'created' });
    expect(account.preRegisterCustomer).toHaveBeenCalledWith('081200001111', 'Siti');
  });

  it('forwards a name/phone correction from hr-service', async () => {
    account.updateStaffProfileInternal.mockResolvedValue({
      id: 'cust-3',
      phone: '+628129999999',
      fullName: 'Budi Santoso',
      email: null,
      role: Role.STAFF_DEPOT,
      status: 'ACTIVE',
      avatarUrl: null,
      assignedDepotId: 'depot-1',
      createdAt: new Date(),
    });

    const out = await controller.updateStaffProfile({
      customerId: 'cust-3',
      fullName: 'Budi Santoso',
      phone: '08129999999',
    } as never);

    expect(account.updateStaffProfileInternal).toHaveBeenCalledWith('cust-3', {
      fullName: 'Budi Santoso',
      phone: '08129999999',
    });
    expect(out).toMatchObject({ fullName: 'Budi Santoso', phone: '+628129999999' });
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

// The pair is the point: the same office/superuser roles stay unreachable from BOTH, but
// the supervision chain is reachable from the form and not from a file.
describe('ProvisionManagedStaffDto role allowlist', () => {
  async function errorsFor(role: string): Promise<string[]> {
    const dto = plainToInstance(ProvisionManagedStaffDto, { phone: '+628123456789', role });
    return (await validate(dto)).map((e) => e.property);
  }

  it.each(['STAFF_DEPOT', 'KEPALA_DEPOT', 'ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'MANAGER'])(
    'accepts %s',
    async (role) => {
      expect(await errorsFor(role)).not.toContain('role');
    },
  );

  it.each([
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

  // Widening the import DTO would have been the smaller diff and the wrong one.
  it('leaves the spreadsheet path narrower than the form path', async () => {
    const viaImport = plainToInstance(ProvisionStaffDto, {
      phone: '+628123456789',
      role: 'SUPERVISOR',
    });
    expect((await validate(viaImport)).map((e) => e.property)).toContain('role');
  });
});

/*
 * F8. crm asks auth-service which accounts an operational alert about a depot should reach.
 * Ids only, behind the internal key: crm needs somewhere to send a push, not a roster.
 */
describe('InternalAccountController — depot staff ids (F8)', () => {
  it('answers with the ids the account service resolves', async () => {
    const account = { staffIdsForDepot: jest.fn().mockResolvedValue(['s-1', 's-2']) };
    const controller = new InternalAccountController(account as never, {} as never);
    expect(await controller.staffIdsForDepot('dep-1')).toEqual({ ids: ['s-1', 's-2'] });
    expect(account.staffIdsForDepot).toHaveBeenCalledWith('dep-1');
  });

  it('answers with an empty list rather than null for a depot with nobody on it', async () => {
    const account = { staffIdsForDepot: jest.fn().mockResolvedValue([]) };
    const controller = new InternalAccountController(account as never, {} as never);
    expect(await controller.staffIdsForDepot('dep-1')).toEqual({ ids: [] });
  });
});
