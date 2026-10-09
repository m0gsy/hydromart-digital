import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Prisma } from '../../prisma/generated/client';
import { AnalyticsPrismaRepository } from '../../src/infrastructure/prisma/analytics.prisma.repository';
import { PayrollPrismaRepository } from '../../src/infrastructure/prisma/payroll.prisma.repository';
import { PayrollService } from '../../src/application/services/payroll.service';

const HOME = '11111111-1111-1111-1111-111111111111';
const AWAY = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
const manager = (depotId: string): AuthenticatedUser =>
  ({ sub: 'm', role: 'MANAGER' as never, phone: null, depotId, depotIds: [depotId] }) as AuthenticatedUser;
const hq = { sub: 'hq', role: 'HR' as never, phone: null, depotId: null } as AuthenticatedUser;

const dec = (n: number) => ({ toNumber: () => n, valueOf: () => n, toString: () => String(n) });
const slip = {
  id: 'pay_1',
  employeeId: 'emp_1',
  periodMonth: '2026-09',
  status: 'DRAFT',
  gross: 3_000_000,
  totalBonus: 100_000,
  totalDeduction: 50_000,
  net: 3_050_000,
  presentDays: 30,
  items: [{ kind: 'BASE', label: 'Gaji pokok', amount: 3_000_000 }],
};
const SHARES = [
  { depotId: HOME, days: 20, gross: 2_000_000, bonus: 60_000, deduction: 30_000, shortfall: 0, net: 2_030_000 },
  { depotId: AWAY, days: 10, gross: 1_000_000, bonus: 40_000, deduction: 20_000, shortfall: 0, net: 1_020_000 },
];

function build(opts: { enabled?: boolean; shares?: typeof SHARES } = {}) {
  const repo = {
    findById: async () => slip,
    findShares: jest.fn(async () => opts.shares ?? SHARES),
    setStatus: jest.fn(async () => slip),
    list: jest.fn(),
  };
  const employee = { id: 'emp_1', fullName: 'Budi', depotId: AWAY, homeDepotId: HOME };
  const employees = { getById: async () => employee };
  const svc = new PayrollService(
    repo as never,
    { summary: async () => ({ presentDays: 0, lateDays: 0, leaveDays: 0, pendingDays: 0 }) } as never,
    {} as never,
    {} as never,
    employees as never,
    { depotAssignmentEnabled: opts.enabled ?? true, timeZone: 'Asia/Jakarta' } as never,
  );
  return { svc, repo };
}

describe('a slip as the depot that only borrowed the person sees it', () => {
  it('the home depot and head office see the whole slip', async () => {
    const { svc } = build();
    expect((await svc.getById(manager(HOME), 'pay_1')).items).toHaveLength(1);
    expect((await svc.getById(hq, 'pay_1')).net).toBe(3_050_000);
  });

  it('the depot the person was lent to sees only its own share, with no lines', async () => {
    const { svc } = build();
    const seen = await svc.getById(manager(AWAY), 'pay_1');
    expect(seen.items).toEqual([]);
    expect(Number(seen.gross)).toBe(1_000_000);
    expect(Number(seen.totalBonus)).toBe(40_000);
    expect(Number(seen.totalDeduction)).toBe(20_000);
    expect(Number(seen.net)).toBe(1_020_000);
    expect(seen.presentDays).toBe(10);
  });

  it('what the floor made uncollectable still counts as assessed on the borrowing depot share', async () => {
    const { svc } = build({
      shares: [{ depotId: AWAY, days: 10, gross: 1_000_000, bonus: 0, deduction: 900_000, shortfall: 300_000, net: 100_000 }],
    });
    const seen = await svc.getById(manager(AWAY), 'pay_1');
    expect(Number(seen.totalDeduction)).toBe(1_200_000);
    expect(Number(seen.net)).toBe(100_000);
  });

  it('a depot that carries no share of it gets nothing', async () => {
    const { svc } = build();
    await expect(svc.shareOnly(manager(OTHER), slip as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the home depot and head office are also told how the slip is split; the borrowing depot is not', async () => {
    const { svc } = build();
    expect((await svc.getById(manager(HOME), 'pay_1')).shares).toEqual(SHARES);
    expect((await svc.getById(hq, 'pay_1')).shares).toEqual(SHARES);
    expect(await svc.getById(manager(AWAY), 'pay_1')).not.toHaveProperty('shares');
  });

  it('an unsplit slip carries no shares field at all', async () => {
    const { svc } = build({ shares: [] });
    expect(await svc.getById(manager(HOME), 'pay_1')).not.toHaveProperty('shares');
  });

  it('the borrowing depot can never approve or pay it', async () => {
    const { svc, repo } = build();
    await expect(svc.approve(manager(AWAY), 'pay_1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.markPaid(manager(AWAY), 'pay_1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('with the feature off nothing is hidden or looked up', async () => {
    const { svc, repo } = build({ enabled: false });
    const seen = await svc.getById(manager(AWAY), 'pay_1');
    expect(seen.items).toHaveLength(1);
    expect(seen).not.toHaveProperty('shares');
    expect(repo.findShares).not.toHaveBeenCalled();
  });

  it('the share a slip carries adds back to the slip (the invariant the report relies on)', () => {
    const total = SHARES.reduce((a, s) => a + s.net, 0);
    expect(total).toBe(slip.net);
  });
});

describe('the payroll list', () => {
  function listed(rows: unknown[], user: AuthenticatedUser, enabled = true) {
    const repo = { list: jest.fn(async () => ({ rows, total: rows.length })) };
    const svc = new PayrollService(
      repo as never, {} as never, {} as never, {} as never, {} as never,
      { depotAssignmentEnabled: enabled, timeZone: 'Asia/Jakarta' } as never,
    );
    return svc.list(user, { page: 1, pageSize: 20 });
  }
  const row = { ...slip, employeeName: 'Budi', homeDepotId: HOME, shares: SHARES };

  it('the home depot keeps the whole row and loses only the helper fields', async () => {
    const { rows } = await listed([row], manager(HOME));
    expect(Number(rows[0].net)).toBe(3_050_000);
    expect(rows[0]).not.toHaveProperty('shares');
    expect(rows[0]).not.toHaveProperty('homeDepotId');
    expect(rows[0]).toMatchObject({ employeeName: 'Budi' });
  });

  it('a borrowing depot is shown its share instead', async () => {
    const { rows } = await listed([row], manager(AWAY));
    expect(Number(rows[0].net)).toBe(1_020_000);
  });

  it('head office sees every row whole; a slip with no split is untouched', async () => {
    expect(Number((await listed([row], hq)).rows[0].net)).toBe(3_050_000);
    expect(Number((await listed([{ ...row, shares: [] }], manager(AWAY))).rows[0].net)).toBe(3_050_000);
  });

  it('feature off: the repository rows pass straight through', async () => {
    const { rows } = await listed([row], manager(AWAY), false);
    expect(Number(rows[0].net)).toBe(3_050_000);
  });
});

describe('PayrollPrismaRepository by share', () => {
  const D = (n: number) => ({ toNumber: () => n, valueOf: () => n }) as never;
  function build(enabled: boolean) {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      payroll: { findMany, count: jest.fn().mockResolvedValue(0) },
      payrollDepotShare: {
        findMany: jest.fn().mockResolvedValue([
          { depotId: HOME, days: 20, gross: D(2), bonus: D(0), deduction: D(0), shortfall: D(0), net: D(2) },
        ]),
      },
      $transaction: jest.fn(async (qs: unknown[]) => Promise.all(qs)),
    };
    return {
      prisma,
      repo: new PayrollPrismaRepository(prisma as never, { depotAssignmentEnabled: enabled } as never),
    };
  }

  it('lists the slips a depot carries a share of, or whose unsplit employee is there', async () => {
    const { prisma, repo } = build(true);
    await repo.list({ depotIds: [HOME], skip: 0, take: 10 });
    const arg = prisma.payroll.findMany.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      { shares: { some: { depotId: { in: [HOME] } } } },
      { shares: { none: {} }, employee: { depotId: { in: [HOME] } } },
    ]);
    expect(arg.include.shares).toBe(true);
  });

  it('feature off, or no depot scope: the old query', async () => {
    const off = build(false);
    await off.repo.list({ depotIds: [HOME], skip: 0, take: 10 });
    expect(off.prisma.payroll.findMany.mock.calls[0][0].where.employee).toEqual({ depotId: { in: [HOME] } });
    const hqCall = build(true);
    await hqCall.repo.list({ skip: 0, take: 10 });
    expect(hqCall.prisma.payroll.findMany.mock.calls[0][0].where).not.toHaveProperty('OR');
  });

  it('maps rows to plain numbers and names the home depot, falling back to the live one', async () => {
    const { prisma, repo } = build(true);
    prisma.payroll.findMany.mockResolvedValue([
      { id: 'a', employee: { fullName: 'Budi', homeDepotId: HOME, depotId: AWAY }, shares: [{ depotId: HOME, days: 1, gross: D(5), bonus: D(0), deduction: D(1), shortfall: D(0), net: D(4) }] },
      { id: 'b', employee: { fullName: 'Sari', homeDepotId: null, depotId: AWAY }, shares: [] },
      { id: 'c', employee: null, shares: [] },
    ]);
    const { rows } = await repo.list({ depotIds: [HOME], skip: 0, take: 10 });
    expect(rows[0]).toMatchObject({ employeeName: 'Budi', homeDepotId: HOME, shares: [{ depotId: HOME, gross: 5, net: 4 }] });
    expect(rows[1]).toMatchObject({ homeDepotId: AWAY });
    expect(rows[2]).toMatchObject({ employeeName: null, homeDepotId: null });
  });

  it('findShares returns numbers, ordered', async () => {
    const { repo } = build(true);
    await expect(repo.findShares('pay_1')).resolves.toEqual([
      { depotId: HOME, days: 20, gross: 2, bonus: 0, deduction: 0, shortfall: 0, net: 2 },
    ]);
  });
});

describe('AnalyticsPrismaRepository reads payroll by share', () => {
  function build(enabled: boolean, rows: unknown[]) {
    const queryRaw = jest.fn().mockResolvedValue(rows);
    const groupBy = jest.fn().mockResolvedValue([]);
    const aggregate = jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } });
    const prisma = {
      $queryRaw: queryRaw,
      payroll: { aggregate, groupBy, findMany: jest.fn().mockResolvedValue([]) },
      attendance: { groupBy },
      employee: { groupBy },
    };
    return { queryRaw, aggregate, repo: new AnalyticsPrismaRepository(prisma as never, { depotAssignmentEnabled: enabled } as never) };
  }
  // The scope fragments are nested Sql objects; render them too so the whole statement is read.
  const sql = (call: unknown[]) =>
    (call[0] as string[]).join('?') + ' ' + call.slice(1).map((v) => (v as { sql?: string })?.sql ?? '').join(' ');

  it('totals sum the shares of the depots asked about, counting each slip once', async () => {
    const { repo, queryRaw } = build(true, [
      { gross: dec(3_000_000), bonus: dec(1), deduction: dec(2), net: dec(2_999_999), count: BigInt(2) },
    ]);
    const out = await repo.payrollTotals('2026-09', [HOME]);
    expect(out).toEqual({ gross: 3_000_000, totalBonus: 1, totalDeduction: 2, net: 2_999_999, count: 2 });
    const text = sql(queryRaw.mock.calls[0]);
    expect(text).toContain('COALESCE(s."net", p."net")');
    expect(text).toContain('COUNT(DISTINCT p."id")');
  });

  it('totals of nothing are zero, not NaN', async () => {
    const { repo } = build(true, [{ gross: null, bonus: null, deduction: null, net: null, count: BigInt(0) }]);
    await expect(repo.payrollTotals('2026-09', [HOME])).resolves.toEqual({ gross: 0, totalBonus: 0, totalDeduction: 0, net: 0, count: 0 });
    const none = build(true, []);
    await expect(none.repo.payrollTotals('2026-09', [HOME])).resolves.toMatchObject({ count: 0, net: 0 });
  });

  it('status counts count distinct slips', async () => {
    const { repo, queryRaw } = build(true, [{ status: 'DRAFT', count: BigInt(3) }]);
    await expect(repo.payrollByStatus('2026-09', [HOME])).resolves.toEqual([{ key: 'DRAFT', count: 3 }]);
    expect(sql(queryRaw.mock.calls[0])).toContain('COUNT(DISTINCT p."id")');
  });

  it('head office, or the feature off, keeps the plain aggregate', async () => {
    const hqCase = build(true, []);
    await hqCase.repo.payrollTotals('2026-09');
    expect(hqCase.aggregate).toHaveBeenCalled();
    expect(hqCase.queryRaw).not.toHaveBeenCalled();
    const off = build(false, []);
    await off.repo.payrollTotals('2026-09', [HOME]);
    expect(off.aggregate).toHaveBeenCalled();
  });

  it('the dashboard fact query groups by the depot that carries each share', async () => {
    const { repo, queryRaw } = build(true, [{ depotId: HOME, net: dec(5), gross: dec(6) }]);
    // attendance/employee groupBy are mocked to []
    const facts = await repo.depotSummaryFacts(new Date('2026-09-30T00:00:00.000Z'), '2026-09', [HOME]);
    expect(facts.get(HOME)).toMatchObject({ payrollMtdNet: 5, payrollMtdGross: 6 });
    const text = sql(queryRaw.mock.calls[0]);
    expect(text).toContain('COALESCE(s."depotId", e."depotId")');
    expect(text).toContain('payroll_depot_shares');
  });

  it('the export shows each slip as the depots asked about carry it', async () => {
    const queryRaw = jest.fn();
    const findMany = jest.fn().mockResolvedValue([
      { id: 'a', gross: 9, totalBonus: 9, totalDeduction: 9, net: 9, presentDays: 30, employee: { employeeCode: 'E1', fullName: 'Budi' },
        shares: [
          { gross: new Prisma.Decimal(2), bonus: new Prisma.Decimal(1), deduction: new Prisma.Decimal(1), shortfall: new Prisma.Decimal(1), net: new Prisma.Decimal(1), days: 10 },
        ] },
      { id: 'b', gross: 7, net: 7, employee: { employeeCode: 'E2', fullName: 'Sari' }, shares: [] },
    ]);
    const prisma = { $queryRaw: queryRaw, payroll: { findMany } };
    const repo = new AnalyticsPrismaRepository(prisma as never, { depotAssignmentEnabled: true } as never);
    const rows = await repo.payrollForReport('2026-09', [HOME]);
    expect(Number(rows[0].gross)).toBe(2);
    expect(Number(rows[0].totalDeduction)).toBe(2); // deduction + shortfall
    expect(Number(rows[0].net)).toBe(1);
    expect(rows[0].presentDays).toBe(10);
    expect(rows[0]).not.toHaveProperty('shares');
    expect(rows[1].gross).toBe(7); // an unsplit slip is left exactly as it was
    expect(findMany.mock.calls[0][0].where.OR).toHaveLength(2);
  });
});
