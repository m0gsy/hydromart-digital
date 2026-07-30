import {
  CustomerNotFoundError,
  EmailAlreadyRegisteredError,
  InvalidStaffRoleError,
  StaffDepotRequiredError,
} from '../../src/domain/errors/auth.errors';
import { Role } from '../../src/domain/customer/role.enum';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { AccountService } from '../../src/application/services/account.service';
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

describe('AccountService', () => {
  let customers: InMemoryCustomerRepository;
  let sessions: SessionService;
  let audit: InMemoryAuditLogRepository;
  let service: AccountService;

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
    service = new AccountService(customers, sessions, new AuditService(audit));
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

    await expect(
      service.updateProfile(me.id, { email: 'taken@x.com' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
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
  it.each([Role.STAFF_DEPOT, Role.KEPALA_DEPOT, Role.MANAGER])(
    'refuses to invite %s without a depot',
    async (role) => {
      await expect(service.inviteStaff('+628990001199', role, 'Tanpa Depot')).rejects.toBeInstanceOf(
        StaffDepotRequiredError,
      );
    },
  );

  // Roles that are not depot-locked keep working with no depot at all.
  it('invites an office role without a depot', async () => {
    const staff = await service.inviteStaff('+628990001188', Role.HEAD_OFFICE, 'Kantor');
    expect(staff).toMatchObject({ role: Role.HEAD_OFFICE, status: 'ACTIVE' });
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
    expect(driver).toMatchObject({ role: Role.STAFF_DEPOT, vehicleType: 'MOTOR', plateNumber: 'B 1234 ABC' });

    // Same vehicle payload on a non-driver role is dropped (not a courier).
    const operator = await service.inviteStaff('+628990001313', Role.KEPALA_DEPOT, 'Sari', 'depot-1', {
      vehicleType: 'MOTOR',
      plateNumber: 'B 9999 ZZ',
    });
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
    customers.seed(makeCustomer({ phone: '+628991110003', role: Role.HEAD_OFFICE, createdAt: feb }));
    customers.seed(makeCustomer({ phone: '+628991110004', role: Role.CUSTOMER, createdAt: new Date('2025-12-01T00:00:00Z') }));

    const all = await service.countNewCustomers();
    expect(all).toBe(3); // three CUSTOMER rows regardless of date
    const windowed = await service.countNewCustomers(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z'),
    );
    expect(windowed).toBe(1); // only the January customer
  });

  it('lists only active STAFF_DEPOT accounts for dispatch', async () => {
    customers.seed(
      makeCustomer({ phone: '+628990007777', role: Role.STAFF_DEPOT, status: CustomerStatus.ACTIVE, fullName: 'Andi' }),
    );
    // A STAFF_DEPOT who is not yet active must be excluded.
    customers.seed(
      makeCustomer({ phone: '+628990008888', role: Role.STAFF_DEPOT, status: CustomerStatus.PENDING_VERIFICATION }),
    );
    // Active non-drivers and customers must be excluded.
    customers.seed(
      makeCustomer({ phone: '+628990009999', role: Role.KEPALA_DEPOT, status: CustomerStatus.ACTIVE }),
    );
    customers.seed(
      makeCustomer({ phone: '+628990001010', role: Role.CUSTOMER, status: CustomerStatus.ACTIVE }),
    );

    const drivers = await service.listDrivers();
    expect(drivers).toHaveLength(1);
    expect(drivers[0]).toMatchObject({ fullName: 'Andi', role: Role.STAFF_DEPOT, status: CustomerStatus.ACTIVE });
    expect(drivers.every((d) => d.role === Role.STAFF_DEPOT && d.status === CustomerStatus.ACTIVE)).toBe(true);
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
