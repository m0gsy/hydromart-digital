import {
  CustomerNotFoundError,
  EmailAlreadyRegisteredError,
  InvalidStaffRoleError,
} from '../../src/domain/errors/auth.errors';
import { Role } from '../../src/domain/customer/role.enum';
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
    const staff = await service.inviteStaff('+628990001111', Role.DEPOT_OPERATOR, 'Sari');
    expect(staff).toMatchObject({ role: Role.DEPOT_OPERATOR, status: 'ACTIVE', fullName: 'Sari' });
  });

  it('promotes an existing customer to a staff role', async () => {
    const customer = makeCustomer({ phone: '+628990002222', role: Role.CUSTOMER });
    customers.seed(customer);

    const promoted = await service.inviteStaff('+628990002222', Role.DEPOT_MANAGER);
    expect(promoted.id).toBe(customer.id);
    expect(promoted.role).toBe(Role.DEPOT_MANAGER);
  });

  it('rejects assigning the CUSTOMER role via invite', async () => {
    await expect(service.inviteStaff('+628990003333', Role.CUSTOMER)).rejects.toBeInstanceOf(
      InvalidStaffRoleError,
    );
  });

  it('lists only non-customer accounts', async () => {
    customers.seed(makeCustomer({ phone: '+628990004444', role: Role.CUSTOMER }));
    customers.seed(makeCustomer({ phone: '+628990005555', role: Role.DEPOT_OPERATOR }));
    customers.seed(makeCustomer({ phone: '+628990006666', role: Role.HEAD_OFFICE }));

    const staff = await service.listStaff(1, 20);
    expect(staff.total).toBe(2);
    expect(staff.items.every((s) => s.role !== Role.CUSTOMER)).toBe(true);
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
