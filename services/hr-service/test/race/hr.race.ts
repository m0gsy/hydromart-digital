import { randomUUID } from 'node:crypto';

import { LeavePrismaRepository } from '../../src/infrastructure/prisma/leave.prisma.repository';
import { LoanRequestPrismaRepository } from '../../src/infrastructure/prisma/loan-request.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('hr on real Postgres — concurrent deciders', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let loanRequests: LoanRequestPrismaRepository;
  let leave: LeavePrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    loanRequests = new LoanRequestPrismaRepository(prisma as never);
    leave = new LeavePrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const employee = () =>
    prisma.employee.create({
      data: {
        employeeCode: `E-${randomUUID().slice(0, 8)}`,
        fullName: 'Budi',
        phone: '0811',
        position: 'Kasir',
        employmentStatus: 'PERMANENT',
        joinDate: new Date('2026-01-01'),
        salaryType: 'MONTHLY',
        monthlyRate: 5_000_000,
      },
    });

  it('twenty approvers of one kasbon request: exactly one wins the decision', async () => {
    const emp = await employee();
    const request = await prisma.loanRequest.create({
      data: { employeeId: emp.id, depotId: randomUUID(), amount: 500_000, reason: 'sekolah' },
    });

    const results = await race(
      Array.from({ length: 20 }, () => () =>
        loanRequests.decide(request.id, {
          status: 'APPROVED',
          decidedBy: randomUUID(),
          decisionNote: null,
          loanId: null,
        }),
      ),
    );

    const winners = results.filter((r) => (r as PromiseFulfilledResult<unknown>).value);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    // Only the winner goes on to create a loan; the other nineteen get null and create none.
    expect(winners).toHaveLength(1);
  });

  it('twenty HR approvers of one leave request: exactly one wins the decision', async () => {
    const emp = await employee();
    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        type: 'ANNUAL',
        startDate: new Date('2026-07-06'),
        endDate: new Date('2026-07-10'),
        workingDays: 5,
        reason: 'x',
        status: 'PENDING_HR',
      },
    });

    const results = await race(
      Array.from({ length: 20 }, () => () =>
        leave.decide(request.id, 'PENDING_HR', { status: 'APPROVED', hrDecidedBy: randomUUID() }),
      ),
    );

    expect(results.filter((r) => (r as PromiseFulfilledResult<unknown>).value)).toHaveLength(1);
  });

  it('approvals racing for the last days of a quota never overflow it', async () => {
    for (let round = 0; round < 5; round++) {
      const emp = await employee();
      await leave.ensureBalance(emp.id, 2026, 12);

      // Ten approvals of 5 days each against a 12-day quota: at most two can fit.
      const results = await race(
        Array.from({ length: 10 }, () => () => leave.claimUsedDays(emp.id, 2026, 5)),
      );

      const claimed = results.filter((r) => (r as PromiseFulfilledResult<boolean>).value);
      expect(claimed).toHaveLength(2);
      const balance = (await leave.findBalance(emp.id, 2026))!;
      expect(balance.usedDays).toBe(10);
      expect(balance.usedDays).toBeLessThanOrEqual(balance.quotaDays);
    }
  });

  it('releasing claimed days never takes usedDays below zero', async () => {
    const emp = await employee();
    await leave.ensureBalance(emp.id, 2026, 12);
    await leave.claimUsedDays(emp.id, 2026, 3);

    await leave.releaseUsedDays(emp.id, 2026, 10);

    expect((await leave.findBalance(emp.id, 2026))!.usedDays).toBe(0);
  });
});
