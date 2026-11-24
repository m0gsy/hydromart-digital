import { AuthenticatedUser } from '@hydromart/platform';

import { PayrollService } from '../../src/application/services/payroll.service';
import { ReportsController } from '../../src/modules/reports.controller';
import { salesWindow } from '../../src/domain/sales-window';

// HD-6 A2: the SALES_TOTAL bonus and the performance sales score read the WHOLE WIB month,
// [start of month, start of next month), and a shortfall report compares it with what was paid.

const user = { sub: 'hr', role: 'HR', phone: null, depotId: null } as unknown as AuthenticatedUser;

describe('salesWindow', () => {
  it('is [00:00 WIB on the 1st, 00:00 WIB on the 1st of next month)', () => {
    expect(salesWindow('2026-07')).toEqual({
      from: new Date('2026-06-30T17:00:00.000Z'),
      to: new Date('2026-07-31T17:00:00.000Z'),
    });
  });

  it('counts 23:30 WIB on the last day in the month and 00:30 WIB on day 1 in the next one', () => {
    const { from, to } = salesWindow('2026-07');
    const lastNight = new Date('2026-07-31T16:30:00Z'); // 23:30 WIB, 31 Jul
    const firstMorning = new Date('2026-07-31T17:30:00Z'); // 00:30 WIB, 1 Aug
    expect(lastNight >= from && lastNight < to).toBe(true);
    expect(firstMorning >= from && firstMorning < to).toBe(false);
    expect(new Date('2026-06-30T16:59:59Z') >= from).toBe(false); // last second of June WIB
    expect(new Date('2026-06-30T17:00:00Z') >= from).toBe(true); // first instant of July WIB
    expect(salesWindow('2026-08').from).toEqual(to);
  });

  it('rolls over the year', () => {
    expect(salesWindow('2026-12').to).toEqual(new Date('2026-12-31T17:00:00.000Z'));
  });
});

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  metric: 'SALES_TOTAL',
  op: 'GTE',
  threshold: 1_000_000,
  rewardKind: 'FIXED',
  rewardValue: 100_000,
  maxIdr: null,
  ...over,
});
const slip = (id: string, status: string, name: string | null = 'Budi') => ({
  id,
  employeeId: `emp-${id}`,
  employeeName: name,
  status,
});
const full = (bonus: number, ref = 'r1') => ({
  items: [
    { kind: 'BASE', amount: 2_000_000, sourceRef: null },
    ...(bonus ? [{ kind: 'BONUS', amount: bonus, sourceRef: ref }] : []),
    { kind: 'BONUS', amount: 5_000, sourceRef: 'other' },
  ],
});

function build(opts: {
  pages?: unknown[][];
  slips?: Record<string, unknown>;
  rules?: unknown[];
  sales?: number | null;
  depotId?: string | null;
  noSales?: boolean;
  noRules?: boolean;
}) {
  const pages = opts.pages ?? [[]];
  const list = jest.fn(async ({ skip }: { skip: number }) => ({
    rows: pages[skip / 100] ?? [],
    total: 0,
  }));
  const repo = { list, findById: jest.fn(async (id: string) => opts.slips?.[id] ?? null) };
  const employees = {
    getById: jest.fn(async () => ({ depotId: opts.depotId === undefined ? 'd1' : opts.depotId })),
  };
  const bonusRules = { listActiveForDepot: jest.fn(async () => opts.rules ?? [rule()]) };
  const sales = { depotSales: jest.fn(async () => (opts.sales === undefined ? null : opts.sales)) };
  const svc = new PayrollService(
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    employees as never,
    {} as never,
    undefined,
    opts.noRules ? undefined : (bonusRules as never),
    undefined,
    opts.noSales ? undefined : (sales as never),
  );
  return { svc, repo, sales, bonusRules, employees };
}

describe('PayrollService.salesBonusShortfallReport', () => {
  it('lists paid vs whole-month bonus for APPROVED/PAID slips only, never touching a DRAFT', async () => {
    const t = build({
      pages: [[slip('a', 'PAID'), slip('b', 'DRAFT'), slip('c', 'APPROVED', null)]],
      slips: { a: full(0), c: full(100_000) },
      sales: 2_000_000,
    });
    const out = await t.svc.salesBonusShortfallReport(user, '2026-07');
    expect(out.headers).toEqual([
      'periodMonth',
      'employeeId',
      'name',
      'status',
      'paidBonus',
      'correctBonus',
      'difference',
    ]);
    expect(out.rows).toEqual([
      ['2026-07', 'emp-a', 'Budi', 'PAID', 0, 100_000, 100_000],
      ['2026-07', 'emp-c', '', 'APPROVED', 100_000, 100_000, 0],
    ]);
    // the whole WIB month, asked once per depot
    expect(t.sales.depotSales).toHaveBeenCalledTimes(1);
    expect(t.sales.depotSales).toHaveBeenCalledWith(
      'd1',
      new Date('2026-06-30T17:00:00.000Z'),
      new Date('2026-07-31T17:00:00.000Z'),
    );
    expect(t.bonusRules.listActiveForDepot).toHaveBeenCalledTimes(1);
  });

  it('leaves correct and difference blank when sales are unknown, and skips no-bonus rows', async () => {
    const t = build({
      pages: [[slip('a', 'PAID'), slip('b', 'PAID')]],
      slips: { a: full(100_000), b: full(0) },
      sales: null,
    });
    expect((await t.svc.salesBonusShortfallReport(user, '2026-07')).rows).toEqual([
      ['2026-07', 'emp-a', 'Budi', 'PAID', 100_000, '', ''],
    ]);
  });

  it('prices a percent rule on the slip base pay, with its ceiling', async () => {
    const t = build({
      pages: [[slip('a', 'PAID')]],
      slips: { a: full(0) },
      sales: 5_000_000,
      rules: [
        rule({ rewardKind: 'PERCENT', rewardValue: 10, maxIdr: 150_000 }),
        rule({ id: 'x', metric: 'PRESENT_DAYS' }),
      ],
    });
    expect((await t.svc.salesBonusShortfallReport(user, '2026-07')).rows[0]![5]).toBe(150_000);
  });

  it('pages through every slip and ignores slips without SALES rules or a stored slip', async () => {
    const first = Array.from({ length: 100 }, (_, i) => slip(`p${i}`, 'DRAFT'));
    const t = build({
      pages: [first, [slip('a', 'PAID'), slip('gone', 'PAID')]],
      slips: { a: full(0) },
      rules: [rule({ metric: 'PRESENT_DAYS' })],
    });
    expect((await t.svc.salesBonusShortfallReport(user, '2026-07')).rows).toEqual([]);
    expect(t.repo.list).toHaveBeenCalledTimes(2);

    const missing = build({ pages: [[slip('gone', 'PAID')]], sales: 9_000_000 });
    expect((await missing.svc.salesBonusShortfallReport(user, '2026-07')).rows).toEqual([]);
  });

  it('never asks for sales of an employee with no home depot', async () => {
    const t = build({
      pages: [[slip('a', 'PAID')]],
      slips: { a: full(100_000) },
      depotId: null,
      sales: 9,
    });
    expect((await t.svc.salesBonusShortfallReport(user, '2026-07')).rows).toEqual([
      ['2026-07', 'emp-a', 'Budi', 'PAID', 100_000, '', ''],
    ]);
    expect(t.sales.depotSales).not.toHaveBeenCalled();
  });

  it('is empty when the rule repository or the sales port is not wired', async () => {
    for (const o of [{ noSales: true }, { noRules: true }]) {
      const t = build({ pages: [[slip('a', 'PAID')]], slips: { a: full(1) }, ...o });
      expect((await t.svc.salesBonusShortfallReport(user, '2026-07')).rows).toEqual([]);
    }
  });
});

describe('ReportsController.payrollSalesBonusShortfall', () => {
  it('is delivered like every report', async () => {
    const report = jest.fn().mockResolvedValue({ headers: ['a'], rows: [['1']] });
    const res = { setHeader: jest.fn(), send: jest.fn() };
    const c = new ReportsController(
      { csv: () => 'a\n1' } as never,
      { salesBonusShortfallReport: report } as never,
    );
    await c.payrollSalesBonusShortfall({ periodMonth: '2026-07' } as never, user, res as never);
    expect(report).toHaveBeenCalledWith(user, '2026-07');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('selisih-bonus-penjualan-2026-07.csv'),
    );
  });
});
