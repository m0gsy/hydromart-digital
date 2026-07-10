import { AuditAction, AuditService } from '../../src/application/services/audit.service';
import { SessionService } from '../../src/application/services/session.service';
import { TokenService } from '../../src/application/services/token.service';
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

describe('TokenService', () => {
  let sessions: SessionService;
  let audit: InMemoryAuditLogRepository;
  let customers: InMemoryCustomerRepository;
  let service: TokenService;

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
    service = new TokenService(sessions, new AuditService(audit));
  });

  it('refreshes a token and records the audit event', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    const first = await sessions.issueForCustomer(customer, ctx);

    const rotated = await service.refresh({ refreshToken: first.refreshToken, context: ctx });
    expect(rotated.customer.id).toBe(customer.id);
    expect(audit.actions()).toContain(AuditAction.TOKEN_REFRESHED);
  });

  it('logs out a single session and records the audit event', async () => {
    const customer = makeCustomer();
    customers.seed(customer);
    const session = await sessions.issueForCustomer(customer, ctx);

    await service.logout({
      refreshToken: session.refreshToken,
      actorCustomerId: customer.id,
      context: ctx,
    });
    expect(audit.actions()).toContain(AuditAction.LOGOUT);
    expect(await sessions.listActive(customer.id)).toHaveLength(0);
  });
});
