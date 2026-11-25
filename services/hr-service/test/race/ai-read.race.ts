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
    repo = new AiReadPrismaRepository(prisma as never, { weeklyOffDays: () => '0' });
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
    const homeGate = async () => {
      const rows = await repo.payrollGate([H1, L1], MONTH);
      return { home: rows[0], lentTo: rows[1] };
    };
    // H3's gate is on the HOME basis, as its amounts: DRAFT, the home depot is waiting, the lent-to depot waits for nobody
    let g = await homeGate();
    expect(g.home).toEqual({ depotId: H1, expected: 1, draft: 1, final: 0 });
    expect(g.lentTo).toEqual({ depotId: L1, expected: 0, draft: 0, final: 0 });
    // H2's gate stays on the LIVE-depot basis of the P&L and cash-flow amounts it guards: the lent-to depot waits
    const live = async () => (await analytics.depotSummaryFacts(new Date('2026-11-15T00:00:00Z'), MONTH, [H1, L1])).get(L1);
    expect(await live()).toMatchObject({ payrollExpectedCount: 1, payrollDraftCount: 1, payrollFinalCount: 0 });
    await prisma.payroll.update({ where: { id: slip.id }, data: { status: 'APPROVED' } });
    g = await homeGate();
    expect(g.home).toEqual({ depotId: H1, expected: 1, draft: 0, final: 1 });
    expect(await live()).toMatchObject({ payrollExpectedCount: 1, payrollDraftCount: 0, payrollFinalCount: 1 });
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
    expect(rows[0]).toMatchObject({ depotId: D1, present: 1, late: 1 });
    expect((await repo.attendance([D1], '2026-11-01', '2026-11-30')).heads).toMatchObject({ present: [a.id], late: [a.id], absentRecorded: [] });
  });

  it('counts scheduled workdays: a rotation week, a holiday, leave, no schedule, a joiner and a leaver (choice 35A)', async () => {
    const D3 = '77777777-7777-4777-8777-777777777777';
    const make = (join: string, o: Record<string, unknown> = {}) =>
      prisma.employee.create({
        data: {
          employeeCode: `E-${randomUUID().slice(0, 8)}`,
          fullName: 'Hadir',
          phone: '0811',
          position: 'Kasir',
          employmentStatus: 'PERMANENT',
          joinDate: new Date(`${join}T00:00:00Z`),
          salaryType: 'MONTHLY',
          monthlyRate: 5_000_000,
          depotId: D3,
          status: 'ACTIVE',
          ...o,
        } as never,
      });
    const mark = (employeeId: string, d: string, status: string) =>
      prisma.attendance.create({ data: { employeeId, depotId: D3, workDate: new Date(`${d}T00:00:00Z`), status } as never });
    const a = await make('2026-01-01'); // Mon-Fri rotation
    const b = await make('2026-01-01'); // no shift of their own
    const c = await make('2026-11-20', { shiftId: randomUUID() }); // joiner on a fixed shift
    const d = await make('2026-01-01', { shiftId: randomUUID(), exitDate: new Date('2026-11-02T00:00:00Z') }); // leaver
    const rotation = await prisma.shiftRotation.create({
      data: { name: 'Senin-Jumat', pattern: { 1: 'S', 2: 'S', 3: 'S', 4: 'S', 5: 'S' } } as never,
    });
    await prisma.shiftAssignment.create({ data: { employeeId: a.id, rotationId: rotation.id, effectiveFrom: new Date('2026-01-01T00:00:00Z') } as never });
    await prisma.holiday.create({ data: { date: new Date('2026-11-04T00:00:00Z'), name: 'Libur', depotId: null } as never });
    await mark(a.id, '2026-11-02', 'PRESENT');
    await mark(a.id, '2026-11-03', 'LATE');
    await mark(a.id, '2026-11-05', 'LEAVE');
    await mark(c.id, '2026-11-30', 'PRESENT'); // the last day of the window is in
    await mark(c.id, '2026-12-01', 'PRESENT'); // the day after is not
    await mark(d.id, '2026-11-02', 'ABSENT');
    const config = { weeklyOffDays: () => '0' }; // the depot rests on Sundays
    const out = await new AiReadPrismaRepository(prisma as never, config).attendance([D3], '2026-11-01', '2026-11-30');
    expect(out.rows[0]).toEqual({
      depotId: D3,
      present: 2,
      late: 1,
      absentRecorded: 1,
      leave: 1,
      pending: 0,
      // a: 21 weekdays less the 4 Nov holiday = 20; c: 20-30 Nov less 2 Sundays = 9; d: 2 Nov only = 1
      scheduledDays: 30,
      attendedScheduled: 3,
      absentScheduled: 17 + 8 + 1,
      // b has no shift: 25 non-Sundays less the holiday, counted apart
      unscheduledDays: 24,
    });
    expect(out.heads.scheduledDays.sort()).toEqual([a.id, c.id, d.id].sort());
    expect(out.heads.unscheduledDays).toEqual([b.id]);
    expect(out.heads.attendedScheduled.sort()).toEqual([a.id, c.id].sort());
    expect(out.heads.absentScheduled.sort()).toEqual([a.id, c.id, d.id].sort());
  });
});
