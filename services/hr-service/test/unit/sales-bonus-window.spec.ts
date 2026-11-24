import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
  flag?: boolean;
  homeDepotId?: string | null;
  salesRejects?: boolean;
  employeeThrows?: Error;
}) {
  const pages = opts.pages ?? [[]];
  const list = jest.fn(async ({ skip }: { skip: number }) => ({
    rows: pages[skip / 100] ?? [],
    total: 0,
  }));
  const repo = { list, findById: jest.fn(async (id: string) => opts.slips?.[id] ?? null) };
  const employees = {
    getById: jest.fn(async () => {
      if (opts.employeeThrows) throw opts.employeeThrows;
      return {
        depotId: opts.depotId === undefined ? 'd1' : opts.depotId,
        homeDepotId: opts.homeDepotId ?? null,
      };
    }),
  };
  const bonusRules = { listActiveForDepot: jest.fn(async () => opts.rules ?? [rule()]) };
  const sales = {
    depotSales: jest.fn(async () => {
      if (opts.salesRejects) throw new Error('down');
      return opts.sales === undefined ? null : opts.sales;
    }),
  };
  const svc = new PayrollService(
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    employees as never,
    { depotAssignmentEnabled: !!opts.flag } as never,
    undefined,
    opts.noRules ? undefined : (bonusRules as never),
    undefined,
    opts.noSales ? undefined : (sales as never),
  );
  return { svc, repo, sales, bonusRules, employees };
}

const data = async (t: ReturnType<typeof build>) => {
  const out = await t.svc.salesBonusShortfallReport(user, '2026-07');
  return out.rows.slice(0, -1);
};

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
      'rules',
      'paidBonus',
      'correctBonus',
      'difference',
    ]);
    expect(out.rows.slice(0, -1)).toEqual([
      ['2026-07', 'emp-a', 'Budi', 'PAID', 1, 0, 100_000, 100_000],
      ['2026-07', 'emp-c', '', 'APPROVED', 1, 100_000, 100_000, 0],
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
    expect(await data(t)).toEqual([
      ['2026-07', 'emp-a', 'Budi', 'PAID', 1, 100_000, '', ''],
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
    expect((await data(t))[0]![6]).toBe(150_000);
  });

  it('pages through every slip and ignores slips without SALES rules or a stored slip', async () => {
    const first = Array.from({ length: 100 }, (_, i) => slip(`p${i}`, 'DRAFT'));
    const t = build({
      pages: [first, [slip('a', 'PAID'), slip('gone', 'PAID')]],
      slips: { a: full(0) },
      rules: [rule({ metric: 'PRESENT_DAYS' })],
    });
    expect(await data(t)).toEqual([]);
    expect(t.repo.list).toHaveBeenCalledTimes(2);

    const missing = build({ pages: [[slip('gone', 'PAID')]], sales: 9_000_000 });
    expect(await data(missing)).toEqual([]);
  });

  it('never asks for sales of an employee with no home depot', async () => {
    const t = build({
      pages: [[slip('a', 'PAID')]],
      slips: { a: full(100_000) },
      depotId: null,
      sales: 9,
    });
    expect(await data(t)).toEqual([
      ['2026-07', 'emp-a', 'Budi', 'PAID', 1, 100_000, '', ''],
    ]);
    expect(t.sales.depotSales).not.toHaveBeenCalled();
  });

  it('prices a lent employee from the home depot when depots can lend staff, like generate()', async () => {
    const lent = build({
      pages: [[slip('a', 'PAID')]],
      slips: { a: full(0) },
      depotId: 'lent',
      homeDepotId: 'home',
      flag: true,
      sales: 2_000_000,
    });
    await data(lent);
    expect(lent.bonusRules.listActiveForDepot).toHaveBeenCalledWith('home');
    expect(lent.sales.depotSales).toHaveBeenCalledWith('home', expect.any(Date), expect.any(Date));

    const off = build({ pages: [[slip('a', 'PAID')]], slips: { a: full(0) }, depotId: 'lent', homeDepotId: 'home', sales: 1 });
    await data(off);
    expect(off.bonusRules.listActiveForDepot).toHaveBeenCalledWith('lent');
  });

  it('blanks a depot whose sales call fails, skips an unreadable employee, and says so in the note', async () => {
    const down = build({ pages: [[slip('a', 'PAID')]], slips: { a: full(100_000) }, salesRejects: true });
    expect(await data(down)).toEqual([['2026-07', 'emp-a', 'Budi', 'PAID', 1, 100_000, '', '']]);

    const gone = build({ pages: [[slip('a', 'PAID'), slip('b', 'PAID')]], employeeThrows: new NotFoundException() });
    const out = await gone.svc.salesBonusShortfallReport(user, '2026-07');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]![2]).toContain('2 slip dilewati');
    expect(out.rows[0]![2]).toContain('HARI INI'); // the rules-in-force caveat travels with the file

    const forbidden = build({ pages: [[slip('a', 'PAID')]], employeeThrows: new ForbiddenException() });
    expect((await forbidden.svc.salesBonusShortfallReport(user, '2026-07')).rows[0]![2]).toContain(
      '1 slip dilewati',
    );
  });

  it('does not hide a database error as a skipped row', async () => {
    const t = build({ pages: [[slip('a', 'PAID')]], employeeThrows: new Error('connection lost') });
    await expect(t.svc.salesBonusShortfallReport(user, '2026-07')).rejects.toThrow('connection lost');
  });

  it('is empty when the rule repository or the sales port is not wired', async () => {
    for (const o of [{ noSales: true }, { noRules: true }]) {
      const t = build({ pages: [[slip('a', 'PAID')]], slips: { a: full(1) }, ...o });
      expect(await data(t)).toEqual([]);
    }
  });
});

jest.mock('../../src/domain/payroll-pdf', () => ({
  ...jest.requireActual('../../src/domain/payroll-pdf'),
  tableReportPdf: jest.fn(async () => Buffer.from('%PDF')),
}));

describe('ReportsController.payrollSalesBonusShortfall', () => {
  it('puts the rules caveat in the PDF subtitle (pdfkit wraps it)', async () => {
    const { tableReportPdf } = jest.requireMock('../../src/domain/payroll-pdf');
    const res = { setHeader: jest.fn(), send: jest.fn() };
    const c = new ReportsController(
      {} as never,
      { salesBonusShortfallReport: async () => ({ headers: ['a'], rows: [['1']] }) } as never,
    );
    await c.payrollSalesBonusShortfall({ periodMonth: '2026-07', format: 'pdf' } as never, user, res as never);
    expect(tableReportPdf).toHaveBeenCalledWith(
      expect.objectContaining({ subtitle: expect.stringContaining('HARI INI') }),
    );
  });

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
