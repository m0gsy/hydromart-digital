import { randomUUID } from 'node:crypto';

import {
  SettlementAlreadyExistsError,
  SettlementNotSubmittedError,
} from '../../src/domain/errors';
import { SettlementStatus } from '../../src/domain/settlement';
import { SettlementPrismaRepository } from '../../src/infrastructure/prisma/settlement.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('cash settlements on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: SettlementPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new SettlementPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const raised = () =>
    prisma.cashSettlement.create({
      data: {
        shiftId: randomUUID(),
        driverId: randomUUID(),
        depotId: randomUUID(),
        orderIds: [],
        expectedAmount: 75_000,
        depositedAmount: 60_000,
        variance: -15_000,
        chargeRequestedBy: randomUUID(),
        chargeRequestedAt: new Date(),
      },
    });

  it('two approvers: exactly one claims the charge', async () => {
    for (let i = 0; i < 15; i++) {
      const s = await raised();
      const res = await race([
        () => repo.claimChargeApproval(s.id, randomUUID()),
        () => repo.claimChargeApproval(s.id, randomUUID()),
      ]);
      const claims = res.map((r) => (r as PromiseFulfilledResult<boolean>).value);
      expect(claims.filter(Boolean)).toHaveLength(1);
    }
  });

  it('an approval racing a rejection: either the claim or the clear wins, never both', async () => {
    for (let i = 0; i < 20; i++) {
      const s = await raised();
      const res = await race([
        () => repo.claimChargeApproval(s.id, randomUUID()),
        () => repo.clearChargeRequest(s.id, 'ditolak'),
      ]);
      const claimed = (res[0] as PromiseFulfilledResult<boolean>).value === true;
      const cleared = res[1].status === 'fulfilled';
      // If the approver holds the claim, the debit may already be on its way: reject must lose.
      expect(claimed && cleared).toBe(false);
      expect(claimed || cleared).toBe(true);
    }
  });

  it('a released claim can be taken again', async () => {
    const s = await raised();
    const first = randomUUID();
    expect(await repo.claimChargeApproval(s.id, first)).toBe(true);
    await repo.releaseChargeApproval(s.id, first);
    expect(await repo.claimChargeApproval(s.id, randomUUID())).toBe(true);
  });

  it('two rulings on one settlement: the second is refused', async () => {
    for (let i = 0; i < 10; i++) {
      const s = await raised();
      const verified = { status: SettlementStatus.VERIFIED, verifiedBy: randomUUID(), verifiedAt: new Date() };
      const disputed = { status: SettlementStatus.VERIFIED, verifiedBy: randomUUID(), verifiedAt: new Date() };
      const res = await race([
        () => repo.resolve(s.id, { ...verified, chargedToDriver: false, note: null }),
        () => repo.resolve(s.id, { ...disputed, chargedToDriver: false, note: null }),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
        SettlementNotSubmittedError,
      );
    }
  });

  it('two submits for one shift: one row, the other told it exists', async () => {
    const shiftId = randomUUID();
    const data = {
      shiftId,
      driverId: randomUUID(),
      depotId: randomUUID(),
      orderIds: [],
      expectedAmount: 1,
      depositedAmount: 1,
      variance: 0,
    };
    const res = await race([() => repo.create(data), () => repo.create(data)]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
      SettlementAlreadyExistsError,
    );
  });
});
