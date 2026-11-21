import { TotpPrismaRepository } from '../../src/infrastructure/prisma/repositories/totp.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

/*
 * HD-4: one authenticator code, or one recovery code, presented by several requests at once.
 * The replay guard is a single conditional UPDATE; only Postgres can prove it holds.
 */
describeRace('TOTP guards on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: TotpPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new TotpPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  async function enrolledAccount(): Promise<string> {
    const { id } = await prisma.customer.create({
      data: { phone: `+62${Math.floor(Math.random() * 1e10)}`, role: 'HEAD_OFFICE' },
    });
    expect(await repo.startEnrolment(id, 'v1.sealed')).toBe(true);
    expect(await repo.confirm(id, 10, new Date(), ['h1', 'h2'])).toBe(true);
    return id;
  }

  it('eight requests with the same code: exactly one is accepted', async () => {
    const id = await enrolledAccount();
    const res = await race(Array.from({ length: 8 }, () => () => repo.acceptStep(id, 11)));
    const won = res.filter((r) => (r as PromiseFulfilledResult<boolean>).value === true);
    expect(won).toHaveLength(1);
    expect((await repo.find(id))!.lastStep).toBe(11);
    expect(await repo.acceptStep(id, 11)).toBe(false);
  });

  it('twelve tries at once each get their own number, and none get one while locked', async () => {
    const id = await enrolledAccount();
    const now = new Date();
    const res = await race(Array.from({ length: 12 }, () => () => repo.claimAttempt(id, now)));
    const numbers = res.map((r) => (r as PromiseFulfilledResult<number>).value).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));

    await repo.lock(id, new Date(now.getTime() + 60_000));
    const locked = await race(Array.from({ length: 4 }, () => () => repo.claimAttempt(id, now)));
    expect(locked.map((r) => (r as PromiseFulfilledResult<number | null>).value)).toEqual([null, null, null, null]);
    expect((await repo.find(id))!.failedAttempts).toBe(0);
    // Once the lock has passed, counting starts again from one.
    await expect(repo.claimAttempt(id, new Date(now.getTime() + 61_000))).resolves.toBe(1);
  });

  it('eight requests with the same recovery code: exactly one spends it', async () => {
    const id = await enrolledAccount();
    const res = await race(Array.from({ length: 8 }, () => () => repo.spendRecoveryCode(id, 'h1', new Date())));
    expect(res.filter((r) => (r as PromiseFulfilledResult<boolean>).value === true)).toHaveLength(1);
    expect(await repo.countRecoveryCodesLeft(id)).toBe(1);
  });

  it('a confirmed authenticator survives a new enrolment attempt, and a reset removes it all', async () => {
    const id = await enrolledAccount();
    expect(await repo.startEnrolment(id, 'v1.other')).toBe(false);
    expect((await repo.find(id))!.secretSealed).toBe('v1.sealed');
    expect(await repo.remove(id)).toBe(true);
    expect(await prisma.totpRecoveryCode.count({ where: { customerId: id } })).toBe(0);
  });

  it('two confirmations of one enrolment: one wins, and only its recovery codes are stored', async () => {
    const { id } = await prisma.customer.create({
      data: { phone: `+62${Math.floor(Math.random() * 1e10)}`, role: 'FINANCE' },
    });
    await repo.startEnrolment(id, 'v1.sealed');
    const res = await race([
      () => repo.confirm(id, 5, new Date(), ['a1', 'a2']),
      () => repo.confirm(id, 5, new Date(), ['b1', 'b2']),
    ]);
    expect(res.filter((r) => (r as PromiseFulfilledResult<boolean>).value === true)).toHaveLength(1);
    expect(await repo.countRecoveryCodesLeft(id)).toBe(2);
  });
});
