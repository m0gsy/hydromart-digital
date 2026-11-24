import { randomUUID } from 'node:crypto';

import { AnalyticsPrismaRepository } from '../../src/infrastructure/prisma/analytics.prisma.repository';
import { AiReadPrismaRepository } from '../../src/infrastructure/prisma/ai-read.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H5, on a real Postgres: only APPROVED/PAID slips are totalled (a DRAFT is not), the gallon
 * bonus line is picked out of the bonus total, kasbon is read off what approved slips took, and
 * attendance counts by the work date.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const MONTH = '2026-11';

describeRace('AiReadPrismaRepository on real Postgres (HD-6 H5)', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: AiReadPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new AiReadPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const person = (depotId: string) =>
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
        depotId,
        status: 'ACTIVE',
      } as never,
    });

  it('totals only approved and paid slips, by the employee depot, with the gallon bonus apart', async () => {
    const a = await person(D1);
    const b = await person(D1);
    const c = await person(D1);
    const s1 = await prisma.payroll.create({
      data: { employeeId: a.id, periodMonth: MONTH, status: 'APPROVED', gross: 5_000_000, totalBonus: 300_000, totalDeduction: 100_000, net: 5_200_000 } as never,
    });
    await prisma.payrollItem.create({ data: { payrollId: s1.id, kind: 'BONUS', label: 'Bonus target harian (3 hari)', amount: 200_000 } as never });
    await prisma.payrollItem.create({ data: { payrollId: s1.id, kind: 'BONUS', label: 'Bonus penjualan', amount: 100_000 } as never });
    await prisma.payroll.create({
      data: { employeeId: b.id, periodMonth: MONTH, status: 'PAID', gross: 4_000_000, totalBonus: 0, totalDeduction: 0, net: 4_000_000 } as never,
    });
    await prisma.payroll.create({ data: { employeeId: c.id, periodMonth: MONTH, status: 'DRAFT', gross: 9_000_000, net: 9_000_000 } as never });
    const rows = await repo.payroll([D1, D2], MONTH);
    expect(rows).toEqual([
      { depotId: D1, slips: 2, grossIdr: 9_000_000, bonusIdr: 300_000, deductionIdr: 100_000, netIdr: 9_200_000, gallonBonusIdr: 200_000, gallonPeople: 1 },
      { depotId: D2, slips: 0, grossIdr: 0, bonusIdr: 0, deductionIdr: 0, netIdr: 0, gallonBonusIdr: 0, gallonPeople: 0 },
    ]);
  });

  it('puts a lent employee at the HOME depot in the amounts, the gate and the kasbon alike', async () => {
    const H1 = '55555555-5555-4555-8555-555555555555';
    const L1 = '66666666-6666-4666-8666-666666666666';
    const lent = await prisma.employee.create({
      data: {
        employeeCode: `E-${randomUUID().slice(0, 8)}`,
        fullName: 'Pinjaman',
        phone: '0811',
        position: 'Kasir',
        employmentStatus: 'PERMANENT',
        joinDate: new Date('2026-01-01'),
        salaryType: 'MONTHLY',
        monthlyRate: 5_000_000,
        depotId: L1, // lent to L1 today
        homeDepotId: H1, // belongs to H1
        status: 'ACTIVE',
      } as never,
    });
    const slip = await prisma.payroll.create({ data: { employeeId: lent.id, periodMonth: MONTH, status: 'DRAFT', gross: 7_000_000, net: 7_000_000 } as never });
    const analytics = new AnalyticsPrismaRepository(prisma as never);
    const gate = async () => {
      const facts = await analytics.depotSummaryFacts(new Date('2026-11-15T00:00:00Z'), MONTH, [H1, L1]);
      return { home: facts.get(H1), lentTo: facts.get(L1) };
    };
    // DRAFT: the HOME depot is the one that is waiting, the lent-to depot waits for nobody
    let g = await gate();
    expect(g.home).toMatchObject({ payrollExpectedCount: 1, payrollDraftCount: 1, payrollFinalCount: 0 });
    expect(g.lentTo?.payrollExpectedCount ?? 0).toBe(0);
    await prisma.payroll.update({ where: { id: slip.id }, data: { status: 'APPROVED' } });
    g = await gate();
    expect(g.home).toMatchObject({ payrollExpectedCount: 1, payrollDraftCount: 0, payrollFinalCount: 1 });
    // and the amounts are the home depot's, in the same month
    const rows = await repo.payroll([H1, L1], MONTH);
    expect(rows).toEqual([
      expect.objectContaining({ depotId: H1, slips: 1, grossIdr: 7_000_000 }),
      expect.objectContaining({ depotId: L1, slips: 0, grossIdr: 0 }),
    ]);
    const loan = await prisma.loan.create({ data: { employeeId: lent.id, principal: 900, installmentAmount: 300, startPeriod: '2026-10', active: true } as never });
    expect(loan.id).toBeTruthy();
    expect(await repo.kasbon([H1, L1], MONTH)).toEqual([
      { depotId: H1, people: 1, remainingIdr: 900 },
      { depotId: L1, people: 0, remainingIdr: 0 },
    ]);
  });

  it('reads what is still owed off the approved slips only', async () => {
    const a = await person(D2);
    const loan = await prisma.loan.create({
      data: { employeeId: a.id, principal: 3_000_000, installmentAmount: 1_000_000, startPeriod: '2026-09', active: true } as never,
    });
    const slip = (status: string, periodMonth: string) =>
      prisma.payroll.create({ data: { employeeId: a.id, periodMonth, status, gross: 1, net: 1 } as never });
    const sep = await slip('PAID', '2026-09');
    const oct = await slip('DRAFT', '2026-10');
    await prisma.payrollItem.create({ data: { payrollId: sep.id, kind: 'DEDUCTION', label: 'Kasbon', amount: 1_000_000, sourceRef: loan.id } as never });
    await prisma.payrollItem.create({ data: { payrollId: oct.id, kind: 'DEDUCTION', label: 'Kasbon', amount: 1_000_000, sourceRef: loan.id } as never });
    expect(await repo.kasbon([D2], '2026-11')).toEqual([{ depotId: D2, people: 1, remainingIdr: 2_000_000 }]);
  });

  it('counts attendance by the work date, both ends included, and distinct people', async () => {
    const a = await person(D1);
    const day = (d: string, status: string) =>
      prisma.attendance.create({ data: { employeeId: a.id, depotId: D1, workDate: new Date(`${d}T00:00:00Z`), status } as never });
    await day('2026-10-31', 'PRESENT');
    await day('2026-11-01', 'PRESENT');
    await day('2026-11-30', 'LATE');
    await day('2026-12-01', 'PRESENT');
    const { rows, rolledUp } = await repo.attendance([D1], '2026-11-01', '2026-11-30');
    expect(rolledUp).toBe(false);
    expect(rows[0]).toMatchObject({ depotId: D1, present: 1, late: 1, people: { present: 1, late: 1, absentRecorded: 0 } });
  });
});
