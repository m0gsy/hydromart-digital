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
    await person({ status: 'INACTIVE' }); // no exit date and not ACTIVE: not waited for
    await person({ status: 'RESIGNED' }); // same
    // ACTIVE with a null exit date is expected: the plain `a`, `b`, `c` above
    // an ACTIVE rehire with a stale exit date from before the month IS expected (and has a slip)
    const rehire = await person({ exitDate: new Date('2026-03-31') });
    await slip(rehire.id, 'APPROVED');
    await slip(a.id, 'APPROVED');
    await slip(b.id, 'PAID');
    await slip(c.id, 'DRAFT');
    await slip(joiner.id, 'APPROVED');
    await slip(leaver.id, 'APPROVED');

    const facts = (await repo.depotSummaryFacts(new Date('2026-11-25'), MONTH, [DEPOT])).get(DEPOT)!;
    expect(facts.payrollCount).toBe(6);
    expect(facts.payrollDraftCount).toBe(1);
    expect(facts.payrollFinalCount).toBe(5);
    expect(facts.payrollExpectedCount).toBe(6); // a, b, c, joiner, leaver, rehire
  });

  it('a leaver with an exit date in the month and no slip keeps the month unfinished', async () => {
    const depot = '33333333-3333-4333-8333-333333333333';
    await person({ depotId: depot, status: 'RESIGNED', exitDate: new Date('2026-11-05') });
    const facts = (await repo.depotSummaryFacts(new Date('2026-11-25'), MONTH, [depot])).get(depot)!;
    expect(facts.payrollExpectedCount).toBe(1);
    expect(facts.payrollFinalCount).toBe(0);
  });
});

describeRace('depotSummaryFacts: payslips split by cost share (depot assignment on), on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AnalyticsPrismaRepository;
  const HOME = '44444444-4444-4444-8444-444444444444';
  const HOST = '55555555-5555-4555-8555-555555555555';

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AnalyticsPrismaRepository(prisma as never, { depotAssignmentEnabled: true } as never);
  });
  afterAll(async () => drop?.());

  it('counts expected and final at the HOME depot, so a depot whose only employee is 100% lent out can finish', async () => {
    const lent = await prisma.employee.create({
      data: {
        employeeCode: `E-${randomUUID().slice(0, 8)}`,
        fullName: 'Budi',
        phone: '0811',
        position: 'Kasir',
        employmentStatus: 'PERMANENT',
        joinDate: new Date('2026-01-01'),
        salaryType: 'MONTHLY',
        monthlyRate: 5_000_000,
        depotId: HOME,
        status: 'ACTIVE',
      } as never,
    });
    const payroll = await prisma.payroll.create({
      data: { employeeId: lent.id, periodMonth: MONTH, status: 'APPROVED', gross: 1_000_000, net: 900_000 } as never,
    });
    // the whole cost goes to the host depot
    await prisma.payrollDepotShare.create({ data: { payrollId: payroll.id, depotId: HOST, days: 22, gross: 1_000_000, net: 900_000 } as never });
    const facts = await repo.depotSummaryFacts(new Date('2026-11-25'), MONTH, [HOME, HOST]);
    // finished facts follow the person's own depot
    expect(facts.get(HOME)).toMatchObject({ payrollExpectedCount: 1, payrollFinalCount: 1, payrollDraftCount: 0 });
    // cost totals keep following the share
    expect(facts.get(HOST)).toMatchObject({ payrollMtdGross: 1_000_000, payrollCount: 1 });
    expect(facts.get(HOME)?.payrollMtdGross ?? 0).toBe(0);
    expect(facts.get(HOST)?.payrollExpectedCount ?? 0).toBe(0);
  });
});
