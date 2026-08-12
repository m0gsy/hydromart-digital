import { PayrollService } from '../../src/application/services/payroll.service';

/** HR generating payroll. The D1 scoping needs a caller, and HR is network-wide. */
const USER = { sub: 'hr_1', role: 'HR', depotId: null } as never;

/**
 * D3/D6 — someone who joined or left mid-month is paid for the days they were employed.
 *
 * A MONTHLY salary was a flat `monthlyRate` regardless of when the employment window
 * started or ended. Someone who joined on the 25th received a full month's pay; someone who
 * resigned on the 3rd received one too. Both are money out of the door for days nobody
 * worked, and neither shows up as an error anywhere.
 *
 * Two knock-on defects that the prorate itself would CREATE if it stopped at `basePay`,
 * and which are pinned here because they are the dangerous half:
 *
 *  1. auto-absence. It fines `workingDays - present - leave - pending`. A joiner on the 25th
 *     was never expected on the 1st-24th, so charging them for those days turns a new hire's
 *     first payslip into a fine. The absence window has to be the employment window.
 *  2. allowances (D6). A monthly transport allowance paid in full to someone employed for
 *     three days is the same leak wearing a different label.
 *
 * Every case here also asserts the FULL-MONTH result is untouched — a prorate that changes
 * what a normal employee is paid is a far worse bug than the one it fixes.
 */

const RATE = 3_000_000;

/** 2026-03: 31 days. With Sunday off, 26 working days. */
const PERIOD = '2026-03';

interface Overrides {
  joinDate?: string;
  exitDate?: string | null;
  status?: 'ACTIVE' | 'INACTIVE' | 'RESIGNED';
  presentDays?: number;
  allowance?: number;
}

function build(o: Overrides = {}) {
  const employee = {
    id: 'emp_1',
    depotId: 'dep_1',
    salaryType: 'MONTHLY' as const,
    monthlyRate: RATE,
    dailyRate: null,
    employmentStatus: 'PERMANENT' as const,
    status: o.status ?? 'ACTIVE',
    joinDate: new Date(o.joinDate ?? '2020-01-01T00:00:00.000Z'),
    exitDate: o.exitDate === undefined ? null : o.exitDate && new Date(o.exitDate),
    contractEndDate: null,
    role: null,
  };

  const presentDays = o.presentDays ?? 26;
  const created: { items: { kind: string; label: string; amount: number }[] } = { items: [] };

  const svc = new PayrollService(
    // repo
    {
      findByEmployeeAndPeriod: async () => null,
      create: async (input: { items: { kind: string; label: string; amount: number }[] }) => {
        created.items = input.items;
        return { id: 'pay_1', ...input };
      },
    } as never,
    // attendance
    {
      summary: async () => ({ presentDays, lateDays: 0, leaveDays: 0, pendingDays: 0 }),
      listWorkedMinutes: async () => [],
    } as never,
    // bonuses
    { listByEmployeePeriod: async () => [] } as never,
    // deductions
    { listByEmployeePeriod: async () => [] } as never,
    // employees
    { getById: async () => employee } as never,
    // config
    // Every knob switched OFF except the absence fine, so each assertion below is about the
    // employment window and nothing else. A stray bonus or statutory line would move the
    // totals for a reason that has nothing to do with what is under test.
    {
      weeklyOffDays: () => '0',
      lateDeductionAmount: () => 0,
      absenceDeductionAmount: () => 50_000,
      absentAfterMinutes: () => 0,
      dailySalesBonusTiers: () => '',
      dailyRateTraining: () => 0,
      lateFineCsv: () => '',
      lateTier: () => '',
      overtimeMultiplierPct: () => 0,
      overtimeOffDayMultiplierPct: () => 0,
      standardWorkingMinutes: () => 480,
      statutoryRates: () => '',
      tenureRaiseLadder: () => '',
    } as never,
    undefined, // holidays
    undefined, // bonusRules
    undefined, // loans
    undefined, // sales
    o.allowance
      ? ({
          listActiveForPeriod: async () => [
            { id: 'a1', type: 'TRANSPORT', amount: o.allowance, note: null },
          ],
        } as never)
      : undefined,
  );

  return { svc, created };
}

const amountOf = (items: { kind: string; amount: number }[], kind: string) =>
  items.filter((i) => i.kind === kind).reduce((s, i) => s + i.amount, 0);

describe('D3 — proration by employment window', () => {
  it('pays a full month to someone employed for the whole of it', async () => {
    const { svc, created } = build();
    await svc.generate(USER, 'emp_1', PERIOD);
    // The ordinary case must come out bit-for-bit what it was before the prorate existed.
    expect(amountOf(created.items, 'BASE')).toBe(RATE);
  });

  it('pays a joiner only for the working days after they joined', async () => {
    // Joins 2026-03-25. Working days 25..31 with Sunday off = 25,26,27,28,30,31 → 6 of 26.
    const { svc, created } = build({ joinDate: '2026-03-25T00:00:00.000Z', presentDays: 6 });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(amountOf(created.items, 'BASE')).toBe(Math.round((RATE * 6) / 26));
  });

  it('pays a leaver only up to the day they left', async () => {
    // Leaves 2026-03-03. Working days 1..3 with Sunday off (the 1st is a Sunday) = 2,3 → 2.
    const { svc, created } = build({ exitDate: '2026-03-03T00:00:00.000Z', presentDays: 2 });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(amountOf(created.items, 'BASE')).toBe(Math.round((RATE * 2) / 26));
  });

  it('does not fine a joiner for the days before they existed here', async () => {
    const { svc, created } = build({ joinDate: '2026-03-25T00:00:00.000Z', presentDays: 6 });
    await svc.generate(USER, 'emp_1', PERIOD);
    // A new hire fined for not attending before their first day is the bug the prorate
    // would otherwise introduce, and it is bigger than the one it fixes.
    expect(amountOf(created.items, 'DEDUCTION')).toBe(0);
  });

  it('still fines a full-month employee who actually missed days', async () => {
    const { svc, created } = build({ presentDays: 24 });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(amountOf(created.items, 'DEDUCTION')).toBe(2 * 50_000);
  });
});

describe('D6 — allowances follow the same window', () => {
  it('prorates a monthly allowance for a joiner', async () => {
    const { svc, created } = build({
      joinDate: '2026-03-25T00:00:00.000Z',
      presentDays: 6,
      allowance: 520_000,
    });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(amountOf(created.items, 'ALLOWANCE')).toBe(Math.round((520_000 * 6) / 26));
  });

  it('pays a full allowance for a full month', async () => {
    const { svc, created } = build({ allowance: 520_000 });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(amountOf(created.items, 'ALLOWANCE')).toBe(520_000);
  });
});

describe('who may be generated for at all', () => {
  it('refuses someone who was not employed for one day of the period', async () => {
    // Left in February; this is March. There is no wage to compute.
    const { svc } = build({ exitDate: '2026-02-10T00:00:00.000Z', status: 'RESIGNED' });
    // Matched on the message, not on "it threw": a bare `toThrow()` goes green for a typo
    // in the mock, which is exactly how this test passed before the refusal existed.
    await expect(svc.generate(USER, 'emp_1', PERIOD)).rejects.toThrow(/tidak bekerja/i);
  });

  it('STILL generates the final payslip of someone who left mid-period', async () => {
    // The trap in "reject non-ACTIVE": status flips to RESIGNED the moment they leave, and
    // the final payroll is generated AFTER that. Refusing on status alone makes it
    // impossible to ever pay a leaver their last days.
    const { svc, created } = build({
      exitDate: '2026-03-03T00:00:00.000Z',
      status: 'RESIGNED',
      presentDays: 2,
    });
    await svc.generate(USER, 'emp_1', PERIOD);
    expect(amountOf(created.items, 'BASE')).toBe(Math.round((RATE * 2) / 26));
  });
});
