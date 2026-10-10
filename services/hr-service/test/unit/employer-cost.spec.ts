import { ConfigService } from '@nestjs/config';
import { SettingsCache } from '@hydromart/platform';

import { HrConfigService } from '../../src/config/hr-config.service';
import { AnalyticsService } from '../../src/application/services/analytics.service';
import { bpjsEmployerCosts, type StatutoryRates } from '../../src/domain/statutory';
import { ReportsController } from '../../src/modules/reports.controller';
import { AnalyticsPrismaRepository } from '../../src/infrastructure/prisma/analytics.prisma.repository';

const rates: StatutoryRates = {
  healthEmployeePct: 1,
  healthCeilingIdr: 12_000_000,
  jhtEmployeePct: 2,
  jpEmployeePct: 1,
  jpCeilingIdr: 10_547_400,
  occupationalCostPct: 5,
  occupationalCostCapIdr: 500_000,
  noNpwpSurchargePct: 20,
  healthEmployerPct: 4,
  jhtEmployerPct: 3.7,
  jpEmployerPct: 2,
  jkkPct: 0.24,
  jkmPct: 0.3,
};
const input = (gross: number, kes = true, tk = true) => ({
  grossIdr: gross,
  ptkpStatus: null,
  hasNpwp: true,
  enrolledHealth: kes,
  enrolledEmployment: tk,
});
const by = (lines: { label: string; amountIdr: number }[]) => Object.fromEntries(lines.map((l) => [l.label, l.amountIdr]));

describe('bpjsEmployerCosts', () => {
  it('Rp5.000.000 fully enrolled: the statutory employer half of every scheme', () => {
    expect(by(bpjsEmployerCosts(input(5_000_000), rates))).toEqual({
      'BPJS Kesehatan (perusahaan)': 200_000,
      'BPJS JHT (perusahaan)': 185_000,
      'BPJS Jaminan Pensiun (perusahaan)': 100_000,
      'BPJS JKK (perusahaan)': 12_000,
      'BPJS JKM (perusahaan)': 15_000,
    });
  });

  it('applies the wage ceilings to Kesehatan and JP only', () => {
    const l = by(bpjsEmployerCosts(input(20_000_000), rates));
    expect(l['BPJS Kesehatan (perusahaan)']).toBe(480_000); // 12.000.000 x 4%
    expect(l['BPJS Jaminan Pensiun (perusahaan)']).toBe(210_948); // 10.547.400 x 2%
    expect(l['BPJS JHT (perusahaan)']).toBe(740_000); // no ceiling: 20.000.000 x 3,7%
    expect(l['BPJS JKK (perusahaan)']).toBe(48_000);
  });

  it('follows enrolment: nothing is remitted for a scheme the person is not in', () => {
    expect(bpjsEmployerCosts(input(5_000_000, false, false), rates)).toEqual([]);
    const onlyHealth = bpjsEmployerCosts(input(5_000_000, true, false), rates);
    expect(onlyHealth.map((l) => l.label)).toEqual(['BPJS Kesehatan (perusahaan)']);
    const onlyTk = bpjsEmployerCosts(input(5_000_000, false, true), rates);
    expect(onlyTk).toHaveLength(4);
  });

  it('rates that are not modelled contribute nothing (every payslip caller)', () => {
    const { healthEmployerPct, jhtEmployerPct, jpEmployerPct, jkkPct, jkmPct, ...employeeOnly } = rates;
    void healthEmployerPct; void jhtEmployerPct; void jpEmployerPct; void jkkPct; void jkmPct;
    expect(bpjsEmployerCosts(input(5_000_000), employeeOnly)).toEqual([]);
  });
});

describe('AnalyticsService.employerCostReport', () => {
  const D = (n: number) => ({ toNumber: () => n });
  const slip = (id: string, employeeId: string, gross: number) => ({
    id, employeeId, periodMonth: '2026-09', gross: D(gross),
    employee: { employeeCode: id.toUpperCase(), fullName: `Orang ${id}` },
  });
  function build(opts: { flag?: boolean; noEnrol?: boolean } = {}) {
    const repo: Record<string, unknown> = {
      payrollForReport: jest.fn(async () => [slip('a', 'ea', 5_000_000), slip('b', 'eb', 10_000_000), slip('c', 'ec', 3_000_000)]),
      enrollmentFor: jest.fn(async () => new Map([
        ['ea', { kes: true, tk: true }],
        ['eb', { kes: true, tk: true }],
      ])),
      sharesForPayrolls: jest.fn(async () => new Map([
        ['b', [
          { depotId: 'd1', days: 20, net: 0, gross: 7_000_000 },
          { depotId: 'd2', days: 10, net: 0, gross: 3_000_000 },
        ]],
      ])),
    };
    if (opts.noEnrol) delete repo.enrollmentFor;
    const config = {
      statutoryRates: () => rates,
      employerRates: () => ({}),
      depotAssignmentEnabled: opts.flag ?? true,
      timeZone: 'Asia/Jakarta',
    };
    const directory = { names: async () => new Map([['d1', 'Galaksi']]) };
    return { svc: new AnalyticsService(repo as never, config as never, directory as never), repo };
  }
  const user = { sub: 'hr', role: 'HR' } as never;

  it('per employee, and the company total at the bottom', async () => {
    const { svc } = build();
    const r = await svc.employerCostReport(user, { periodMonth: '2026-09' });
    expect(r.headers.at(-1)).toBe('bebanPerDepot');
    expect(r.headers[3]).toBe('status');
    const total = (row: unknown[]) => row[10];
    expect(total(r.rows[0]!)).toBe(512_000); // 5jt: 200.000+185.000+100.000+12.000+15.000
    expect(total(r.rows[2]!)).toBe(0); // not enrolled: nothing remitted
    const sum = (r.rows[0]![10] as number) + (r.rows[1]![10] as number) + (r.rows[2]![10] as number);
    expect(r.rows.at(-1)).toEqual(['', '', 'TOTAL', '', '', '', '', '', '', '', sum, '']);
  });

  it('divides a split slip between its depots by the gross each carries, exactly', async () => {
    const { svc } = build();
    const r = await svc.employerCostReport(user, { periodMonth: '2026-09' });
    const row = r.rows[1]!;
    const cost = row[10] as number;
    const text = row[11] as string;
    expect(text).toMatch(/^Galaksi: \d+; [0-9a-f]{0,8}|d2: \d+/);
    const parts = text.split('; ').map((p) => Number(p.split(': ')[1]));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(cost);
    expect(parts[0]).toBeGreaterThan(parts[1]!); // 70% vs 30%
  });

  it('flag off or no reader: no per-depot column content, and nobody is called enrolled', async () => {
    const off = await build({ flag: false }).svc.employerCostReport(user, { periodMonth: '2026-09' });
    expect(off.rows[1]![11]).toBe('');
    const none = await build({ noEnrol: true }).svc.employerCostReport(user, { periodMonth: '2026-09' });
    expect(none.rows.at(-1)![10]).toBe(0);
  });
});

describe('route and repository', () => {
  it('the route is delivered like every report', async () => {
    const employerCostReport = jest.fn().mockResolvedValue({ headers: ['a'], rows: [['1']] });
    const csv = jest.fn().mockReturnValue('a,b');
    const res = { setHeader: jest.fn(), send: jest.fn() };
    const c = new ReportsController({ employerCostReport, csv } as never);
    await c.payrollEmployerCost({ periodMonth: '2026-09' } as never, { sub: 'u' } as never, res as never);
    expect(employerCostReport).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('beban-bpjs-perusahaan-2026-09'),
    );
  });

  it('enrolment: a number on file is enrolment, a blank one is not, long lists are chunked', async () => {
    const findMany = jest.fn()
      .mockResolvedValueOnce([
        { id: 'e1', bpjsKes: '0001', bpjsTk: '  ' },
        { id: 'e2', bpjsKes: null, bpjsTk: 'TK-9' },
      ])
      .mockResolvedValueOnce([]);
    const repo = new AnalyticsPrismaRepository({ employee: { findMany } } as never, {} as never);
    const ids = Array.from({ length: 501 }, (_, i) => `e${i}`);
    const out = await repo.enrollmentFor(ids);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(out.get('e1')).toEqual({ kes: true, tk: false });
    expect(out.get('e2')).toEqual({ kes: false, tk: true });
  });
});

describe('HrConfigService.employerRates', () => {
  const cfg = (env: Record<string, string> = {}) =>
    ({ get: <T>(k: string, d?: T) => (env[k] ?? d) as T, getOrThrow: (k: string) => env[k] }) as unknown as ConfigService;
  const empty = () => new SettingsCache({ loadAll: async () => [] });

  it('ships the statutory employer halves, as real percentages', () => {
    const r = new HrConfigService(cfg(), empty()).employerRates();
    expect(r).toEqual({ healthEmployerPct: 4, jhtEmployerPct: 3.7, jpEmployerPct: 2, jkkPct: 0.24, jkmPct: 0.3 });
  });

  it('JKK follows the risk class set in the environment, and statutoryRates is untouched', () => {
    const svc = new HrConfigService(cfg({ HR_BPJS_JKK_PCT_X100: '174' }), empty());
    expect(svc.employerRates().jkkPct).toBeCloseTo(1.74);
    expect(svc.statutoryRates()).not.toHaveProperty('jkkPct');
  });
});
