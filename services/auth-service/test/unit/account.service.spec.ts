import {
  CustomerNotFoundError,
  EmailAlreadyRegisteredError,
  InvalidStaffRoleError,
  StaffDepotRequiredError,
} from '../../src/domain/errors/auth.errors';
import { Role } from '../../src/domain/customer/role.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { AccountService } from '../../src/application/services/account.service';
import type { ProvisionEmployeeInput } from '../../src/application/ports/hr-directory.port';
import { AuditAction, AuditService } from '../../src/application/services/audit.service';
import { SessionService } from '../../src/application/services/session.service';
import {
  FakeAccessTokenSigner,
  FakeClock,
  FakeCrypto,
  InMemoryAuditLogRepository,
  InMemoryCustomerRepository,
  InMemoryRefreshTokenRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';

/** The employment half every console invite now carries; the values are not what is tested. */
const EMPLOYMENT = {
  position: 'Kurir',
  joinDate: '2026-08-04',
  employmentStatus: 'PROBATION',
  salaryType: 'MONTHLY',
  monthlyRate: 4_500_000,
} as const;

describe('AccountService', () => {
  let customers: InMemoryCustomerRepository;
  let sessions: SessionService;
  let audit: InMemoryAuditLogRepository;
  let service: AccountService;
  let hr: {
    calls: ProvisionEmployeeInput[];
    activeCalls: { authSubjectId: string; active: boolean }[];
    anonymised: string[];
    provisionEmployee(i: ProvisionEmployeeInput): Promise<void>;
    provisionEmployees(
      inputs: readonly ProvisionEmployeeInput[],
    ): Promise<{ index: number; ok: boolean; message: string | null }[]>;
    setEmployeeActive(authSubjectId: string, active: boolean): Promise<void>;
    anonymiseEmployee(authSubjectId: string): Promise<void>;
  };

  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    audit = new InMemoryAuditLogRepository();
    sessions = new SessionService(
      new InMemoryRefreshTokenRepository(),
      customers,
      new FakeAccessTokenSigner(),
      new FakeCrypto(),
      new FakeClock(),
      buildTestConfig(),
    );
    hr = {
      calls: [],
      activeCalls: [],
      provisionEmployee: async (input) => void hr.calls.push(input),
      // The batch form the bulk import uses (K-4): same recording, one call.
      provisionEmployees: async (inputs) =>
        inputs.map((input, index) => {
          hr.calls.push(input);
          return { index, ok: true, message: null };
        }),
      setEmployeeActive: async (authSubjectId, active) =>
        void hr.activeCalls.push({ authSubjectId, active }),
      anonymiseEmployee: async (authSubjectId) => void hr.anonymised.push(authSubjectId),
      anonymised: [],
    };
    service = new AccountService(customers, sessions, new AuditService(audit), hr);
  });

  it('returns the public profile of an existing account', async () => {
    const customer = makeCustomer({ fullName: 'Budi', email: 'budi@x.com' });
    customers.seed(customer);

    const profile = await service.getProfile(customer.id);
    expect(profile).toMatchObject({ id: customer.id, fullName: 'Budi', email: 'budi@x.com' });
    // Ensure no secret-bearing fields leak into the public view.
    expect(Object.keys(profile)).toEqual([
      'id',
      'phone',
      'email',
      'fullName',
      'role',
      'status',
      'avatarUrl',
      'assignedDepotId',
      'vehicleType',
      'plateNumber',
      'createdAt',
    ]);
  });

  it('throws when the account does not exist', async () => {
    await expect(service.getProfile('missing')).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('updates name and email, normalizing the email to lowercase', async () => {
    const customer = makeCustomer({ fullName: 'Budi', email: 'budi@x.com' });
    customers.seed(customer);

    const updated = await service.updateProfile(customer.id, {
      fullName: 'Budi Santoso',
      email: 'BUDI@New.Com',
    });
    expect(updated).toMatchObject({ fullName: 'Budi Santoso', email: 'budi@new.com' });
  });

  it('leaves email untouched when only the name is patched', async () => {
    const customer = makeCustomer({ fullName: 'Budi', email: 'budi@x.com' });
    customers.seed(customer);

    const updated = await service.updateProfile(customer.id, { fullName: 'Budi S' });
    expect(updated).toMatchObject({ fullName: 'Budi S', email: 'budi@x.com' });
  });

  it('rejects an email already used by another account', async () => {
    const taken = makeCustomer({ email: 'taken@x.com' });
    const me = makeCustomer({ email: 'me@x.com' });
    customers.seed(taken);
    customers.seed(me);

    await expect(service.updateProfile(me.id, { email: 'taken@x.com' })).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });

  it('allows re-saving the account own email unchanged', async () => {
    const customer = makeCustomer({ email: 'me@x.com' });
    customers.seed(customer);

    const updated = await service.updateProfile(customer.id, { email: 'me@x.com' });
    expect(updated.email).toBe('me@x.com');
  });

  it('invites a new phone as a pre-activated staff account', async () => {
    const staff = await service.inviteStaff('+628990001111', Role.KEPALA_DEPOT, 'Sari', 'depot-1');
    expect(staff).toMatchObject({ role: Role.KEPALA_DEPOT, status: 'ACTIVE', fullName: 'Sari' });
  });

  // A depot-locked role with no depot is a login that 403s on every depot-scoped call,
  // so it is rejected at the write path instead of being created and discovered later.
  it.each([Role.STAFF_DEPOT, Role.KEPALA_DEPOT])(
    'refuses to invite %s without a depot',
    async (role) => {
      await expect(
        service.inviteStaff('+628990001199', role, 'Tanpa Depot'),
      ).rejects.toBeInstanceOf(StaffDepotRequiredError);
    },
  );

  // Roles that are not depot-locked keep working with no depot at all.
  it('invites an office role without a depot', async () => {
    const staff = await service.inviteStaff('+628990001188', Role.HEAD_OFFICE, 'Kantor');
    expect(staff).toMatchObject({ role: Role.HEAD_OFFICE, status: 'ACTIVE' });
  });

  // The mirror image of the HR form: inviting somebody used to create a login and nothing
  // else, so HR had people who could sign in but could not be paid or rostered.
  describe('inviteStaffWithEmployee', () => {
    it('opens the employee record for the account it just created', async () => {
      const staff = await service.inviteStaffWithEmployee({
        ...EMPLOYMENT,
        phone: '+628994440001',
        role: Role.KEPALA_DEPOT,
        fullName: 'Rina',
        depotId: 'depot-1',
      });

      expect(hr.calls).toEqual([
        {
          authSubjectId: staff.id,
          fullName: 'Rina',
          phone: staff.phone,
          role: Role.KEPALA_DEPOT,
          depotId: 'depot-1',
          position: EMPLOYMENT.position,
          joinDate: EMPLOYMENT.joinDate,
          employmentStatus: EMPLOYMENT.employmentStatus,
          salaryType: EMPLOYMENT.salaryType,
          dailyRate: undefined,
          monthlyRate: EMPLOYMENT.monthlyRate,
        },
      ]);
    });

    // A franchise owner is a business counterpart, not headcount: an employee row would put
    // them in payroll totals and depot rosters they have no business being in.
    it('skips the employee record for a franchise owner', async () => {
      await service.inviteStaffWithEmployee({
        ...EMPLOYMENT,
        phone: '+628994440002',
        role: Role.FRANCHISE_OWNER,
        fullName: 'Pemilik',
      });

      expect(hr.calls).toEqual([]);
    });

    // Fail closed: half a person is worse than a refused invite.
    it('refuses the invite when hr-service is not configured', async () => {
      const noHr = new AccountService(customers, sessions, new AuditService(audit));

      await expect(
        noHr.inviteStaffWithEmployee({
          ...EMPLOYMENT,
          phone: '+628994440003',
          role: Role.HEAD_OFFICE,
          fullName: 'Kantor',
        }),
      ).rejects.toThrow(/hr-service/);
    });
  });

  // Until now nothing in the console could switch a staff login off at all, so somebody who
  // resigned on Friday still opened the app on Monday.
  describe('setStaffActive', () => {
    it('suspends the login and tells hr-service, then restores both', async () => {
      const staff = await service.inviteStaff('+628995550001', Role.STAFF_DEPOT, 'Andi', 'depot-1');

      const off = await service.setStaffActive(staff.id, false);
      expect(off.status).toBe(CustomerStatus.SUSPENDED);
      expect(hr.activeCalls).toEqual([{ authSubjectId: staff.id, active: false }]);

      const on = await service.setStaffActive(staff.id, true);
      expect(on.status).toBe(CustomerStatus.ACTIVE);
      expect(hr.activeCalls[1]).toEqual({ authSubjectId: staff.id, active: true });
    });

    // The half hr-service calls. If it answered back, the same change would bounce between
    // the two services forever.
    it('writes without telling hr-service when hr-service is the caller', async () => {
      const staff = await service.inviteStaff('+628995550002', Role.KEPALA_DEPOT, 'Rina', 'depot-1');

      const off = await service.setStaffActiveInternal(staff.id, false);

      expect(off.status).toBe(CustomerStatus.SUSPENDED);
      expect(hr.activeCalls).toEqual([]);
    });

    it('refuses an unknown account and an end customer', async () => {
      await expect(service.setStaffActive('11111111-1111-4111-8111-111111111111', false)).rejects.toBeInstanceOf(
        CustomerNotFoundError,
      );
      const customer = makeCustomer({ phone: '+628995550003', role: Role.CUSTOMER });
      customers.seed(customer);
      await expect(service.setStaffActive(customer.id, false)).rejects.toBeInstanceOf(
        InvalidStaffRoleError,
      );
    });

    // Deleting anonymises the identity; "activate" must not bring back a record nobody can
    // read. Locks the 0a fix to SUSPENDED only.
    it('never revives a deleted account', async () => {
      const deleted = makeCustomer({
        phone: '+628995550004',
        role: Role.STAFF_DEPOT,
        status: CustomerStatus.DELETED,
      });
      customers.seed(deleted);

      const result = await service.setStaffActive(deleted.id, true);

      expect(result.status).toBe(CustomerStatus.DELETED);
    });
  });

  // The bulk wizard is the invite path in a loop, so what matters is that one bad row
  // cannot take the file down with it, and that a re-upload reports the truth.
  describe('importStaff', () => {
    it('creates good rows, fails only the bad one, and calls a re-upload updated', async () => {
      const first = await service.importStaff([
        { ...EMPLOYMENT, phone: '+628990004001', role: Role.HEAD_OFFICE, fullName: 'Kantor' },
        // Depot-locked with no depot: rejected by inviteStaff, so this row alone fails.
        { ...EMPLOYMENT, phone: '+628990004002', role: Role.KEPALA_DEPOT, fullName: 'Tanpa Depot' },
        { ...EMPLOYMENT, phone: '+628990004003', role: Role.STAFF_DEPOT, fullName: 'Joko', depotId: 'depot-1' },
      ]);

      expect(first).toMatchObject({ created: 2, updated: 0, failed: 1 });
      expect(first.results[1]).toMatchObject({ row: 2, status: 'failed' });
      expect(first.results[0].id).toBeDefined();

      // Same file again: the two accounts now exist, so they are promoted, not duplicated.
      const second = await service.importStaff([
        { ...EMPLOYMENT, phone: '+628990004001', role: Role.FINANCE, fullName: 'Kantor' },
        { ...EMPLOYMENT, phone: '+628990004003', role: Role.STAFF_DEPOT, fullName: 'Joko', depotId: 'depot-1' },
      ]);
      expect(second).toMatchObject({ created: 0, updated: 2, failed: 0 });
      expect(second.results[0].id).toBe(first.results[0].id);
    });
  });

  // setStaffRole backs an HR jabatan change: the account already exists and only its role
  // (and possibly its depot) moves. It must never mint an account, and it enforces the same
  // depot rule as the invite path.
  describe('setStaffRole', () => {
    it('rejects demoting to CUSTOMER and an unknown account', async () => {
      const staff = await service.inviteStaff('+628990003001', Role.HEAD_OFFICE, 'Kantor');
      await expect(service.setStaffRole(staff.id, Role.CUSTOMER)).rejects.toBeInstanceOf(
        InvalidStaffRoleError,
      );
      await expect(
        service.setStaffRole('00000000-0000-4000-8000-000000000000', Role.HEAD_OFFICE),
      ).rejects.toBeInstanceOf(CustomerNotFoundError);
    });

    it('keeps the account on its current depot when none is passed', async () => {
      const staff = await service.inviteStaff('+628990003002', Role.STAFF_DEPOT, 'Joko', 'depot-1');
      const moved = await service.setStaffRole(staff.id, Role.KEPALA_DEPOT);
      expect(moved).toMatchObject({ role: Role.KEPALA_DEPOT, assignedDepotId: 'depot-1' });
    });

    it('reassigns the depot when one is passed', async () => {
      const staff = await service.inviteStaff('+628990003003', Role.STAFF_DEPOT, 'Joko', 'depot-1');
      const moved = await service.setStaffRole(staff.id, Role.STAFF_DEPOT, 'depot-2');
      expect(moved.assignedDepotId).toBe('depot-2');
    });

    it('refuses to leave a depot-locked role without a depot', async () => {
      const office = await service.inviteStaff('+628990003004', Role.HEAD_OFFICE, 'Kantor');
      // No depot on the account and none supplied.
      await expect(service.setStaffRole(office.id, Role.KEPALA_DEPOT)).rejects.toBeInstanceOf(
        StaffDepotRequiredError,
      );
      const staff = await service.inviteStaff('+628990003005', Role.STAFF_DEPOT, 'Joko', 'depot-1');
      // Explicitly clearing the depot is refused too.
      await expect(service.setStaffRole(staff.id, Role.STAFF_DEPOT, null)).rejects.toBeInstanceOf(
        StaffDepotRequiredError,
      );
    });

    it('moves an office role that never had a depot', async () => {
      const office = await service.inviteStaff('+628990003006', Role.HEAD_OFFICE, 'Kantor');
      const moved = await service.setStaffRole(office.id, Role.FINANCE);
      expect(moved).toMatchObject({ role: Role.FINANCE, assignedDepotId: null });
    });
  });

  it('resolves a batch of ids to public profiles, deduping and dropping unknowns', async () => {
    const a = makeCustomer({ phone: '+628990002001', fullName: 'Agus' });
    const b = makeCustomer({ phone: '+628990002002', fullName: 'Bima' });
    customers.seed(a);
    customers.seed(b);

    const result = await service.lookupByIds([a.id, b.id, a.id, 'missing-id', '']);
    expect(result.map((c) => c.fullName).sort()).toEqual(['Agus', 'Bima']);
    expect(result).toHaveLength(2);

    expect(await service.lookupByIds([])).toEqual([]);
  });

  it('promotes an existing customer to a staff role', async () => {
    const customer = makeCustomer({ phone: '+628990002222', role: Role.CUSTOMER });
    customers.seed(customer);

    const promoted = await service.inviteStaff('+628990002222', Role.MANAGER, null, 'depot-1');
    expect(promoted.id).toBe(customer.id);
    expect(promoted.role).toBe(Role.MANAGER);
  });

  it('stores vehicle info for an invited STAFF_DEPOT but ignores it for other roles', async () => {
    const driver = await service.inviteStaff('+628990001212', Role.STAFF_DEPOT, 'Joko', 'depot-1', {
      vehicleType: 'MOTOR',
      plateNumber: 'B 1234 ABC',
    });
    expect(driver).toMatchObject({
      role: Role.STAFF_DEPOT,
      vehicleType: 'MOTOR',
      plateNumber: 'B 1234 ABC',
    });

    // Same vehicle payload on a non-driver role is dropped (not a courier).
    const operator = await service.inviteStaff(
      '+628990001313',
      Role.KEPALA_DEPOT,
      'Sari',
      'depot-1',
      {
        vehicleType: 'MOTOR',
        plateNumber: 'B 9999 ZZ',
      },
    );
    expect(operator.vehicleType).toBeNull();
    expect(operator.plateNumber).toBeNull();
  });

  it('pre-registers an unknown phone as a PENDING customer the buyer can claim', async () => {
    const result = await service.preRegisterCustomer('081299887766', 'Siti');
    expect(result.status).toBe('created');

    const created = await customers.findByPhone('+6281299887766');
    expect(created).toMatchObject({
      role: Role.CUSTOMER,
      status: CustomerStatus.PENDING_VERIFICATION,
      fullName: 'Siti',
    });
  });

  it('is idempotent for a phone already waiting on its first OTP', async () => {
    const pending = makeCustomer({
      phone: '+628129900001',
      status: CustomerStatus.PENDING_VERIFICATION,
      fullName: 'Asli',
    });
    customers.seed(pending);

    const result = await service.preRegisterCustomer('+628129900001', 'Diimpor Ulang');
    expect(result).toEqual({ customerId: pending.id, status: 'pending' });
    // The import must not rewrite what the customer will verify.
    expect((await customers.findByPhone('+628129900001'))?.fullName).toBe('Asli');
  });

  it('leaves an already-active account untouched when a depot imports its phone', async () => {
    const active = makeCustomer({ phone: '+628129900002', fullName: 'Punya Orang' });
    customers.seed(active);

    const result = await service.preRegisterCustomer('+628129900002', 'Klaim Palsu');
    expect(result).toEqual({ customerId: active.id, status: 'active' });
    expect((await customers.findByPhone('+628129900002'))?.fullName).toBe('Punya Orang');
  });

  it('rejects assigning the CUSTOMER role via invite', async () => {
    await expect(service.inviteStaff('+628990003333', Role.CUSTOMER)).rejects.toBeInstanceOf(
      InvalidStaffRoleError,
    );
  });

  it('lists only non-customer accounts', async () => {
    customers.seed(makeCustomer({ phone: '+628990004444', role: Role.CUSTOMER }));
    customers.seed(makeCustomer({ phone: '+628990005555', role: Role.KEPALA_DEPOT }));
    customers.seed(makeCustomer({ phone: '+628990006666', role: Role.HEAD_OFFICE }));

    const staff = await service.listStaff(1, 20);
    expect(staff.total).toBe(2);
    expect(staff.items.every((s) => s.role !== Role.CUSTOMER)).toBe(true);
  });

  it('assigns an invited staff member to a depot and filters by it', async () => {
    const staff = await service.inviteStaff('+628990007777', Role.KEPALA_DEPOT, 'Rina', 'depot-1');
    expect(staff.assignedDepotId).toBe('depot-1');
    // A staff member at another depot is excluded by the filter.
    await service.inviteStaff('+628990008888', Role.KEPALA_DEPOT, 'Ari', 'depot-2');

    const atDepot1 = await service.listStaff(1, 20, undefined, 'depot-1');
    expect(atDepot1.total).toBe(1);
    expect(atDepot1.items[0].assignedDepotId).toBe('depot-1');
  });

  it('counts only end-customers created within the window', async () => {
    const jan = new Date('2026-01-10T00:00:00Z');
    const feb = new Date('2026-02-10T00:00:00Z');
    customers.seed(makeCustomer({ phone: '+628991110001', role: Role.CUSTOMER, createdAt: jan }));
    customers.seed(makeCustomer({ phone: '+628991110002', role: Role.CUSTOMER, createdAt: feb }));
    // Excluded: a staff account in-range, and a customer outside the window.
    customers.seed(
      makeCustomer({ phone: '+628991110003', role: Role.HEAD_OFFICE, createdAt: feb }),
    );
    customers.seed(
      makeCustomer({
        phone: '+628991110004',
        role: Role.CUSTOMER,
        createdAt: new Date('2025-12-01T00:00:00Z'),
      }),
    );

    const all = await service.countNewCustomers();
    expect(all).toBe(3); // three CUSTOMER rows regardless of date
    const windowed = await service.countNewCustomers(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(windowed).toBe(1); // only the January customer
  });

  // Before this existed, the only way to move somebody's depot from the console was to
  // re-invite their phone — which also re-roled them and woke a suspended account up.
  it('moves a staff account to another depot without touching role or status', async () => {
    const staff = await service.inviteStaff('+628993330001', Role.STAFF_DEPOT, 'Andi', 'depot-1');

    const moved = await service.setStaffDepot(staff.id, 'depot-2');

    expect(moved).toMatchObject({
      assignedDepotId: 'depot-2',
      role: Role.STAFF_DEPOT,
      status: CustomerStatus.ACTIVE,
    });
  });

  it('never leaves a depot-locked account with no depot, and refuses a customer', async () => {
    const staff = await service.inviteStaff('+628993330002', Role.KEPALA_DEPOT, 'Rina', 'depot-1');
    await expect(service.setStaffDepot(staff.id, null)).rejects.toBeInstanceOf(
      StaffDepotRequiredError,
    );

    const customer = makeCustomer({ phone: '+628993330003', role: Role.CUSTOMER });
    customers.seed(customer);
    await expect(service.setStaffDepot(customer.id, 'depot-1')).rejects.toBeInstanceOf(
      InvalidStaffRoleError,
    );
  });

  it('does not reactivate a suspended account when moving its depot', async () => {
    const suspended = makeCustomer({
      phone: '+628993330004',
      role: Role.STAFF_DEPOT,
      status: CustomerStatus.SUSPENDED,
      assignedDepotId: 'depot-1',
    });
    customers.seed(suspended);

    const moved = await service.setStaffDepot(suspended.id, 'depot-2');

    expect(moved).toMatchObject({
      assignedDepotId: 'depot-2',
      status: CustomerStatus.SUSPENDED,
    });
  });

  it('lists drivers of one depot only when a depot is given', async () => {
    customers.seed(
      makeCustomer({
        phone: '+628992220001',
        role: Role.STAFF_DEPOT,
        status: CustomerStatus.ACTIVE,
        assignedDepotId: 'depot-1',
        fullName: 'Kurir Satu',
      }),
    );
    customers.seed(
      makeCustomer({
        phone: '+628992220002',
        role: Role.STAFF_DEPOT,
        status: CustomerStatus.ACTIVE,
        assignedDepotId: 'depot-2',
        fullName: 'Kurir Dua',
      }),
    );

    const atDepot1 = await service.listDrivers('depot-1');
    expect(atDepot1.map((d) => d.fullName)).toEqual(['Kurir Satu']);
    expect(await service.listDrivers()).toHaveLength(2);
  });

  // The old single 500-row page silently truncated: driver 501 was undispatchable and
  // nothing anywhere said a roster had been cut short.
  it('walks past the first page instead of cutting the roster off', async () => {
    for (let i = 0; i < 260; i += 1) {
      customers.seed(
        makeCustomer({
          phone: `+62899333${String(i).padStart(4, '0')}`,
          role: Role.STAFF_DEPOT,
          status: CustomerStatus.ACTIVE,
          assignedDepotId: 'depot-1',
        }),
      );
    }

    expect(await service.listDrivers('depot-1')).toHaveLength(260);
  });

  it('lists only active STAFF_DEPOT accounts for dispatch', async () => {
    customers.seed(
      makeCustomer({
        phone: '+628990007777',
        role: Role.STAFF_DEPOT,
        status: CustomerStatus.ACTIVE,
        fullName: 'Andi',
      }),
    );
    // A STAFF_DEPOT who is not yet active must be excluded.
    customers.seed(
      makeCustomer({
        phone: '+628990008888',
        role: Role.STAFF_DEPOT,
        status: CustomerStatus.PENDING_VERIFICATION,
      }),
    );
    // Active non-drivers and customers must be excluded.
    customers.seed(
      makeCustomer({
        phone: '+628990009999',
        role: Role.KEPALA_DEPOT,
        status: CustomerStatus.ACTIVE,
      }),
    );
    customers.seed(
      makeCustomer({ phone: '+628990001010', role: Role.CUSTOMER, status: CustomerStatus.ACTIVE }),
    );

    const drivers = await service.listDrivers();
    expect(drivers).toHaveLength(1);
    expect(drivers[0]).toMatchObject({
      fullName: 'Andi',
      role: Role.STAFF_DEPOT,
      status: CustomerStatus.ACTIVE,
    });
    expect(
      drivers.every((d) => d.role === Role.STAFF_DEPOT && d.status === CustomerStatus.ACTIVE),
    ).toBe(true);
  });

  it('lists active sessions and logs out everywhere', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    await sessions.issueForCustomer(customer, ctx);
    await sessions.issueForCustomer(customer, ctx);

    expect(await service.listSessions(customer.id)).toHaveLength(2);

    await service.logoutAll(customer.id, ctx);
    expect(await service.listSessions(customer.id)).toHaveLength(0);
    expect(audit.actions()).toContain(AuditAction.LOGOUT_ALL);
  });
});
