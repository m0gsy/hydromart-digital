import {
  CustomerNotFoundError,
  EmailAlreadyRegisteredError,
} from '../../src/domain/errors/auth.errors';
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
