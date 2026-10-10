import { AnalyticsService } from '../../src/application/services/analytics.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import * as pdfModule from '../../src/domain/payroll-pdf';
import { DepotDirectoryHttpAdapter } from '../../src/infrastructure/http/depot-directory.http.adapter';
import { AnalyticsPrismaRepository } from '../../src/infrastructure/prisma/analytics.prisma.repository';

const HOME = '11111111-1111-1111-1111-111111111111';
const AWAY = '22222222-2222-2222-2222-222222222222';
const hq = { sub: 'hr-1', role: 'HR' } as never;

describe('payrollSlipPdf depot block', () => {
  afterEach(() => jest.resetModules());

  function render(depotShares?: unknown): string[] {
    const lines: string[] = [];
    class Doc {
      fontSize() {
        return this;
      }
      moveDown() {
        return this;
      }
      text(s: string) {
        lines.push(s);
        return this;
      }
      on(ev: string, cb: (c?: Buffer) => void) {
        if (ev === 'end') setImmediate(() => cb());
        return this;
      }
      end() {
        /* noop */
      }
    }
    jest.isolateModules(() => {
      jest.doMock('pdfkit', () => Doc);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { payrollSlipPdf } = require('../../src/domain/payroll-pdf');
      void payrollSlipPdf({
        employeeName: 'Budi',
        employeeCode: 'E1',
        periodMonth: '2026-09',
        status: 'APPROVED',
        lines: [],
        net: 100,
        depotShares,
      });
    });
    return lines;
  }

  it('prints a "Pembagian per depot" block only when there are shares', () => {
    expect(render()).not.toContain('Pembagian per depot');
    const withBlock = render([{ name: 'Galaksi', days: 20, gross: 80, deduction: 0, net: 80 }]);
    expect(withBlock).toContain('Pembagian per depot');
    expect(withBlock.join('\n')).toMatch(/Galaksi · 20 hari/);
  });
});

describe('PayrollService slip print', () => {
  function build(opts: { shares?: unknown[]; enabled?: boolean; noFind?: boolean; names?: Map<string, string> | null }) {
    const payroll = { id: 'p1', employeeId: 'e1', periodMonth: '2026-09', status: 'APPROVED', items: [], net: 100 };
    const repo: Record<string, unknown> = {
      findById: async () => payroll,
      findShares: async () => opts.shares ?? [],
    };
    if (opts.noFind) delete repo.findShares;
    const employee = { id: 'e1', fullName: 'Budi', employeeCode: 'E1', depotId: HOME, homeDepotId: HOME };
    const directory = opts.names === null ? undefined : { names: jest.fn(async () => opts.names ?? new Map()) };
    return new PayrollService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      { findByIdInternal: async () => employee, getById: async () => employee, getSelf: async () => employee } as never,
      { depotAssignmentEnabled: opts.enabled ?? true } as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      directory as never,
    );
  }
  const two = [
    { depotId: HOME, days: 20, gross: 80, bonus: 0, deduction: 0, shortfall: 0, net: 80 },
    { depotId: AWAY, days: 10, gross: 20, bonus: 0, deduction: 0, shortfall: 0, net: 20 },
  ];
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(pdfModule, 'payrollSlipPdf').mockResolvedValue(Buffer.from('pdf'));
  });
  afterEach(() => spy.mockRestore());

  it('names each part on the staff slip and on the employee own slip', async () => {
    const svc = build({ shares: two, names: new Map([[HOME, 'Galaksi']]) });
    await svc.slip(hq, 'p1');
    expect(spy.mock.calls[0][0].depotShares).toEqual([
      { name: 'Galaksi', days: 20, gross: 80, deduction: 0, net: 80 },
      { name: AWAY.slice(0, 8), days: 10, gross: 20, deduction: 0, net: 20 },
    ]);
    await svc.selfSlip({ sub: 'e1' } as never, 'p1');
    expect(spy.mock.calls[1][0].depotShares).toHaveLength(2);
  });

  it('prints no block for one part, the feature off, no split reader or no directory', async () => {
    await build({ shares: [two[0]] }).slip(hq, 'p1');
    await build({ shares: two, enabled: false }).slip(hq, 'p1');
    await build({ shares: two, noFind: true }).slip(hq, 'p1');
    for (const call of spy.mock.calls) expect(call[0]).not.toHaveProperty('depotShares');
    await build({ shares: two, names: null }).slip(hq, 'p1');
    expect(spy.mock.calls[3][0].depotShares[0].name).toBe(HOME.slice(0, 8));
  });
});

describe('payroll export alokasiDepot column', () => {
  const D = (n: number) => ({ toNumber: () => n });
  const rows = [
    {
      id: 'p1',
      periodMonth: '2026-09',
      status: 'APPROVED',
      gross: D(100),
      totalBonus: D(0),
      totalDeduction: D(0),
      net: D(100),
      presentDays: 30,
      employee: { employeeCode: 'E1', fullName: 'Budi' },
    },
  ];
  function build(opts: { enabled: boolean; withShares?: boolean }) {
    const repo: Record<string, unknown> = { payrollForReport: async () => rows };
    if (opts.withShares !== false) {
      repo.sharesForPayrolls = jest.fn(async () => new Map([['p1', [{ depotId: HOME, days: 20, net: 80 }]]]));
    }
    return {
      svc: new AnalyticsService(
        repo as never,
        { depotAssignmentEnabled: opts.enabled, timeZone: 'Asia/Jakarta' } as never,
        { names: async () => new Map([[HOME, 'Galaksi']]) } as never,
      ),
      repo,
    };
  }
  const q = { periodMonth: '2026-09' };

  it('adds the column with the split on', async () => {
    const r = await build({ enabled: true }).svc.payrollReport(hq, q);
    expect(r.headers.at(-1)).toBe('alokasiDepot');
    expect(r.rows[0].at(-1)).toBe('Galaksi: 80 (20 hari)');
  });

  it('leaves the export byte-identical with the split off or no reader', async () => {
    for (const o of [{ enabled: false }, { enabled: true, withShares: false }]) {
      const r = await build(o).svc.payrollReport(hq, q);
      expect(r.headers).toHaveLength(9);
      expect(r.rows[0]).toHaveLength(9);
    }
  });

  it('a slip with no stored split exports an empty cell, not a failure', async () => {
    const { svc, repo } = build({ enabled: true });
    (repo.sharesForPayrolls as jest.Mock).mockResolvedValue(new Map());
    const r = await svc.payrollReport(hq, q);
    expect(r.rows[0].at(-1)).toBe('');
  });
});

describe('AnalyticsPrismaRepository.sharesForPayrolls', () => {
  it('groups by slip, narrows to the reader depots and chunks long id lists', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { payrollId: 'p1', depotId: HOME, days: 2, net: { toString: () => '5' }, gross: { toString: () => '7' } },
    ]);
    const repo = new AnalyticsPrismaRepository({ payrollDepotShare: { findMany } } as never, {} as never);
    const ids = Array.from({ length: 501 }, (_, i) => `p${i}`);
    const out = await repo.sharesForPayrolls(ids, [HOME]);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ depotId: { in: [HOME] } });
    expect(out.get('p1')).toEqual([
      { depotId: HOME, days: 2, net: 5, gross: 7 },
      { depotId: HOME, days: 2, net: 5, gross: 7 },
    ]);
    await repo.sharesForPayrolls(['p1']);
    expect(findMany.mock.calls[2][0].where).not.toHaveProperty('depotId');
  });
});

describe('DepotDirectoryHttpAdapter.names', () => {
  afterEach(() => jest.restoreAllMocks());
  it('names what it can and silently skips what it cannot', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: true, name: 'Galaksi' })))
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    const a = new DepotDirectoryHttpAdapter({ depotService: { url: 'http://d', internalKey: 'k' } } as never);
    const got = await a.names([HOME, AWAY, HOME]);
    expect([...got.entries()]).toEqual([[HOME, 'Galaksi']]);
  });
});
