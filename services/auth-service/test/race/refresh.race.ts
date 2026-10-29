import { randomUUID } from 'node:crypto';

import { SessionService } from '../../src/application/services/session.service';
import { RefreshTokenPrismaRepository } from '../../src/infrastructure/prisma/repositories/refresh-token.prisma.repository';
import {
  FakeAccessTokenSigner,
  FakeClock,
  FakeCrypto,
  FakeSecurityPolicy,
  InMemoryCustomerRepository,
  buildTestConfig,
  makeCustomer,
} from '../support/fakes';
import { describeRace, freshPrisma, race } from './db';

// The fake crypto mints readable ids ('uuid-1'); a uuid column needs real ones.
class RealUuidCrypto extends FakeCrypto {
  uuid(): string {
    return randomUUID();
  }
  generateOpaqueToken(): string {
    return randomUUID();
  }
}

describeRace('SessionService on real Postgres — concurrent refresh', () => {
  let drop: () => Promise<void>;
  let repo: RefreshTokenPrismaRepository;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let customers: InMemoryCustomerRepository;
  let service: SessionService;
  const ctx = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new RefreshTokenPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  beforeEach(() => {
    customers = new InMemoryCustomerRepository();
    service = new SessionService(
      repo,
      customers,
      new FakeAccessTokenSigner(),
      new RealUuidCrypto(),
      new FakeClock(),
      new FakeSecurityPolicy(),
      buildTestConfig(),
    );
  });

  /** A real customer row (the rotation locks it) mirrored into the in-memory lookup. */
  const newCustomer = async () => {
    const id = randomUUID();
    await prisma.customer.create({
      data: { id, phone: `+62${Math.floor(Math.random() * 1e10)}`, status: 'ACTIVE' as never },
    });
    const customer = makeCustomer({ id });
    customers.seed(customer);
    return customer;
  };
  const live = (customerId: string) =>
    prisma.refreshToken.count({ where: { customerId, revokedAt: null } });

  it('twenty refreshes on one cookie produce exactly one live child', async () => {
    const customer = await newCustomer();
    const first = await service.issueForCustomer(customer, ctx);

    const results = await race(
      Array.from({ length: 20 }, () => () => service.refresh(first.refreshToken, ctx)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await live(customer.id)).toBe(1);
    // The old token points at the single child that won.
    const old = await prisma.refreshToken.findFirst({
      where: { customerId: customer.id, replacedById: { not: null } },
    });
    expect(old).not.toBeNull();
  });

  it('a refresh racing logout-everywhere never leaves a live session behind', async () => {
    for (let i = 0; i < 25; i++) {
      const customer = await newCustomer();
      const first = await service.issueForCustomer(customer, ctx);

      await race([
        () => service.refresh(first.refreshToken, ctx),
        () => service.revokeAll(customer.id),
      ]);

      // Whichever order they ran in, "logout everywhere" has to mean everywhere.
      expect(await live(customer.id)).toBe(0);
    }
  });
});
