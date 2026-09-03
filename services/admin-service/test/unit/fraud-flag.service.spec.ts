import { FraudEntityType, FraudLevel, FraudStatus } from '../../src/domain/fraud';
import { FraudFlagNotFoundError } from '../../src/domain/errors';
import { FraudFlagService } from '../../src/application/services/fraud-flag.service';
import {
  FakeAccountSuspension,
  InMemoryFraudFlagRepository,
  makeFraudFlag,
} from '../support/fakes';

describe('FraudFlagService', () => {
  let repo: InMemoryFraudFlagRepository;
  let service: FraudFlagService;

  let accounts: FakeAccountSuspension;

  beforeEach(() => {
    repo = new InMemoryFraudFlagRepository();
    accounts = new FakeAccountSuspension();
    service = new FraudFlagService(repo, accounts);
  });

  it('ingests a flag with the supplied score/level/signals', async () => {
    const rec = await service.ingest({
      entityType: FraudEntityType.ORDER,
      entityRef: 'ORD-1',
      score: 91,
      level: FraudLevel.HIGH,
      signals: ['New address'],
    });
    expect(rec.score).toBe(91);
    expect(rec.status).toBe(FraudStatus.OPEN);
  });

  it('lists highest-score first and filters by level/status', async () => {
    repo.rows = [
      makeFraudFlag({
        entityRef: 'low',
        score: 40,
        level: FraudLevel.LOW,
        status: FraudStatus.OPEN,
      }),
      makeFraudFlag({
        entityRef: 'high',
        score: 90,
        level: FraudLevel.HIGH,
        status: FraudStatus.REVIEWED,
      }),
      makeFraudFlag({
        entityRef: 'mid',
        score: 65,
        level: FraudLevel.MEDIUM,
        status: FraudStatus.OPEN,
      }),
    ];
    const all = await service.list({});
    expect(all.map((f) => f.entityRef)).toEqual(['high', 'mid', 'low']); // highest score first
    expect(await service.list({ level: FraudLevel.HIGH })).toHaveLength(1);
    expect(await service.list({ status: FraudStatus.OPEN })).toHaveLength(2);
  });

  it('review/block/clear transition the status', async () => {
    const f = makeFraudFlag();
    repo.rows = [f];
    expect((await service.review(f.id)).status).toBe(FraudStatus.REVIEWED);
    expect((await service.block(f.id)).status).toBe(FraudStatus.BLOCKED);
    expect((await service.clear(f.id)).status).toBe(FraudStatus.CLEARED);
  });

  it('throws FraudFlagNotFoundError for unknown ids', async () => {
    await expect(service.review('nope')).rejects.toBeInstanceOf(FraudFlagNotFoundError);
    await expect(service.block('nope')).rejects.toBeInstanceOf(FraudFlagNotFoundError);
    await expect(service.clear('nope')).rejects.toBeInstanceOf(FraudFlagNotFoundError);
  });
});

/*
 * CA-2-05: "Blokir" in the fraud queue blocked nothing.
 *
 * It set the FLAG's own status and stopped there — the operator pressed it, the row turned
 * red, and the customer kept ordering. auth-service already refuses a SUSPENDED account at
 * sign-in; nothing ever asked it to.
 */
describe('FraudFlagService blocking the account (CA-2-05)', () => {
  const accountFlag = {
    entityType: FraudEntityType.ACCOUNT,
    entityRef: 'cust-1',
    score: 90,
    level: FraudLevel.HIGH,
    signals: ['many orders, one card'],
  };

  it('suspends the account behind an ACCOUNT flag', async () => {
    const repo = new InMemoryFraudFlagRepository();
    const accounts = new FakeAccountSuspension();
    const service = new FraudFlagService(repo, accounts);
    const flag = await service.ingest(accountFlag);

    const blocked = await service.block(flag.id);

    expect(blocked.status).toBe(FraudStatus.BLOCKED);
    expect(accounts.calls).toEqual([{ customerId: 'cust-1', active: false }]);
  });

  /*
   * The heart of it. A flag that reads BLOCKED while the account still signs in is the
   * exact state being fixed, so an unreachable auth-service must leave the flag OPEN and
   * the operator must see an error — not a false confirmation.
   */
  it('leaves the flag OPEN when the account could not be suspended', async () => {
    const repo = new InMemoryFraudFlagRepository();
    const accounts = new FakeAccountSuspension();
    const service = new FraudFlagService(repo, accounts);
    const flag = await service.ingest(accountFlag);
    accounts.fail = true;

    await expect(service.block(flag.id)).rejects.toThrow(/unreachable/);

    expect((await repo.findById(flag.id))!.status).toBe(FraudStatus.OPEN);
  });

  it('lifts the suspension when the flag is cleared', async () => {
    const repo = new InMemoryFraudFlagRepository();
    const accounts = new FakeAccountSuspension();
    const service = new FraudFlagService(repo, accounts);
    const flag = await service.ingest(accountFlag);
    await service.block(flag.id);

    await service.clear(flag.id);

    expect(accounts.calls).toEqual([
      { customerId: 'cust-1', active: false },
      { customerId: 'cust-1', active: true },
    ]);
  });

  it('does not reinstate an account a flag never blocked', async () => {
    const repo = new InMemoryFraudFlagRepository();
    const accounts = new FakeAccountSuspension();
    const service = new FraudFlagService(repo, accounts);
    const flag = await service.ingest(accountFlag);

    // Reviewed, then cleared: nothing was ever suspended, so nothing is lifted — and an
    // account suspended for some OTHER reason must not be reopened by tidying this queue.
    await service.review(flag.id);
    await service.clear(flag.id);

    expect(accounts.calls).toEqual([]);
  });

  /*
   * An ORDER flag has no account to suspend — `entityRef` is an order id. Blocking one is
   * still a real decision the queue records; it just cannot reach into order-service from
   * here, and that is not pretended at.
   */
  it('records an ORDER flag without touching any account', async () => {
    const repo = new InMemoryFraudFlagRepository();
    const accounts = new FakeAccountSuspension();
    const service = new FraudFlagService(repo, accounts);
    const flag = await service.ingest({
      ...accountFlag,
      entityType: FraudEntityType.ORDER,
      entityRef: 'order-9',
    });

    const blocked = await service.block(flag.id);

    expect(blocked.status).toBe(FraudStatus.BLOCKED);
    expect(accounts.calls).toEqual([]);
  });
});
