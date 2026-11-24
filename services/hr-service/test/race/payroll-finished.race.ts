import { randomUUID } from 'node:crypto';

import { AnalyticsPrismaRepository } from '../../src/infrastructure/prisma/analytics.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H2, on a real Postgres: the batch summary's "is the month's payroll finished" facts: slips
 * still DRAFT, employees with an APPROVED/PAID slip, and employees the month waits for (a mid-month
 * joiner and a mid-month leaver count; someone who left before the month, or an INACTIVE person
 * with no exit date, does not).
 */
const DEPOT = '11111111-1111-4111-8111-111111111111';
const MONTH = '2026-11';

describeRace('AnalyticsPrismaRepository.depotSummaryFacts: payroll finished, on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AnalyticsPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AnalyticsPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const person = (o: Record<string, unknown>) =>
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
        depotId: DEPOT,
        status: 'ACTIVE',
        ...o,
      } as never,
    });
  const slip = (employeeId: string, status: string) =>
    prisma.payroll.create({ data: { employeeId, periodMonth: MONTH, status, gross: 1_000_000, net: 900_000 } as never });

  it('counts who the month waits for and who has an approved or paid slip', async () => {
    const a = await person({});
    const b = await person({});
    const c = await person({});
    const joiner = await person({ joinDate: new Date('2026-11-20') });
    const leaver = await person({ status: 'RESIGNED', exitDate: new Date('2026-11-05') });
    await person({ status: 'RESIGNED', exitDate: new Date('2026-10-31') }); // left before the month
    await person({ joinDate: new Date('2026-12-01') }); // joins after it
    await person({ status: 'INACTIVE' }); // no exit date: not waited for
    await slip(a.id, 'APPROVED');
    await slip(b.id, 'PAID');
    await slip(c.id, 'DRAFT');
    await slip(joiner.id, 'APPROVED');
    await slip(leaver.id, 'APPROVED');

    const facts = (await repo.depotSummaryFacts(new Date('2026-11-25'), MONTH, [DEPOT])).get(DEPOT)!;
    expect(facts.payrollCount).toBe(5);
    expect(facts.payrollDraftCount).toBe(1);
    expect(facts.payrollFinalCount).toBe(4);
    expect(facts.payrollExpectedCount).toBe(5); // a, b, c, joiner, leaver
  });
});
