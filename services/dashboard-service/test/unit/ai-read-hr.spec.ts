import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { HR_METRIC_IDS, HrMetricsService } from '../../src/application/ai-read/hr-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { AiOrgSourcesPort, AttendanceHeads, AttendanceRow, KasbonRow, PayrollGateRow, PayrollRow } from '../../src/application/ports/ai-org-sources.port';
import { DashboardSourcesPort } from '../../src/application/ports/dashboard-sources.port';

/*
 * HD-6 H5, HR metrics (dictionary 3.10). The sources are stubbed; what is under test is the formula,
 * the days each depot may be read for (a depot changing entity mid-period), the finished-payroll gate,
 * payrollRead, the masking of anything resting on fewer than 3 people, and belum_ada / ditahan.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-25T03:00:00.000Z');
const NOVEMBER = { period: 'month', date: '2026-11-10' };
const TODAY = { period: 'day', date: '2026-11-25' };

const user = (role: string): AuthenticatedUser => ({ sub: 'u1', role, depotId: null }) as unknown as AuthenticatedUser;
const span = (depotId: string, from: string, to: string, legalEntityId: string | null = PT_A) => ({ depotId, legalEntityId, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: {
    depotIds: [...new Set(spans.map((s) => s.depotId))].sort(),
    legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
  },
});
// D1 moves PT_A -> PT_B on 16 Nov; D2 is PT_B all month.
const SCOPE = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D1, '2026-11-16', '2026-11-30', PT_B), span(D2, '2026-11-01', '2026-11-30', PT_B)]);

const people = (n: number, from = 0): string[] => Array.from({ length: n }, (_, i) => `e${from + i}`);
const heads = (n: number, o: Partial<AttendanceHeads> = {}): AttendanceHeads => ({ present: people(n), late: people(n), absentRecorded: people(n), leave: people(n), pending: [], ...o });
const att = (depotId: string, o: Partial<AttendanceRow> = {}): AttendanceRow => ({ depotId, present: 20, late: 2, absentRecorded: 1, leave: 1, pending: 0, ...o });
const gate = (depotId: string, o: Partial<PayrollGateRow> = {}): PayrollGateRow => ({ depotId, expected: 4, draft: 0, final: 4, ...o });
const pay = (depotId: string, o: Partial<PayrollRow> = {}): PayrollRow => ({
  depotId,
  slips: 4,
  grossIdr: 20_000_000,
  bonusIdr: 1_000_000,
  deductionIdr: 500_000,
  netIdr: 20_500_000,
  gallonBonusIdr: 600_000,
  gallonPeople: 3,
  ...o,
});
const finished = (ids: string[]) => ids.map((depotId) => ({ depotId, payrollCount: 4, payrollDraftCount: 0, payrollFinalCount: 4, payrollExpectedCount: 4, activeHeadcount: 4 }));

function build(scope: ReadScope = SCOPE, over: Partial<Record<keyof AiOrgSourcesPort, unknown>> = {}) {
  const sources: Record<string, jest.Mock> = {
    attendance: jest.fn(async (ids: readonly string[]) => ({ rows: ids.map((d) => att(d)), heads: heads(5), rolledUp: false })),
    payrollGate: jest.fn(async (ids: readonly string[]): Promise<PayrollGateRow[]> => ids.map((d) => gate(d))),
    payroll: jest.fn(async (ids: readonly string[]) => ids.map((d) => pay(d))),
    kasbon: jest.fn(async (ids: readonly string[]): Promise<KasbonRow[]> => ids.map((depotId) => ({ depotId, people: 4, remainingIdr: 2_500_000 }))),
    ...(over as Record<string, jest.Mock>),
  };
  const depots = { hrSummaryMany: jest.fn(async (ids: string[]) => finished(ids) as unknown[]) };
  const scopes = { resolve: jest.fn(async () => scope) } as unknown as ReadScopeService;
  const service = new HrMetricsService(scopes, sources as unknown as AiOrgSourcesPort, depots as unknown as DashboardSourcesPort);
  const ask = (id: string, role = 'SUPER_ADMIN', query: Record<string, string> = NOVEMBER) => service.answer(id, user(role), query, NOW);
  return { sources, depots, ask };
}

describe('HrMetricsService: H-01 active employees', () => {
  it('counts AKTIF employees by assignment depot for today, from the depots readable today', async () => {
    const { depots, ask } = build();
    depots.hrSummaryMany.mockImplementation(async (ids: string[]) => ids.map((depotId, i) => ({ depotId, activeHeadcount: [5, 4][i] })));
    const out = await ask('H-01', 'SUPER_ADMIN', TODAY);
    expect(out).toMatchObject({ status: 'ok', unit: 'orang', scope: { depotIds: [D1, D2] } });
    expect(out.value).toEqual({
      total: 9,
      byDepot: [
        { depotId: D1, value: 5 },
        { depotId: D2, value: 4 },
      ],
    });
    expect(depots.hrSummaryMany).toHaveBeenCalledWith([D1, D2]);
  });

  it('holds a depot of 1 or 2 employees and the neighbours that would give it away, and the total when the cells run out', async () => {
    const { depots, ask } = build();
    depots.hrSummaryMany.mockImplementation(async (ids: string[]) => ids.map((depotId, i) => ({ depotId, activeHeadcount: [2, 3][i] })));
    expect((await ask('H-01', 'SUPER_ADMIN', TODAY)).value).toEqual({
      total: null,
      totalFlag: 'ditahan',
      byDepot: [
        { depotId: D1, value: null, flag: 'kurang dari 3' },
        { depotId: D2, value: null, flag: 'ditahan' },
      ],
    });
    depots.hrSummaryMany.mockImplementation(async (ids: string[]) => ids.map((depotId, i) => ({ depotId, activeHeadcount: [0, 4][i] })));
    expect((await ask('H-01', 'SUPER_ADMIN', TODAY)).value).toMatchObject({ total: 4, byDepot: [{ value: 0 }, { value: 4 }] });
  });

  it('refuses to answer a period that does not hold today (status history is not kept)', async () => {
    const { ask } = build();
    const old = await ask('H-01', 'SUPER_ADMIN', { period: 'month', date: '2026-10-10' });
    expect(old).toMatchObject({ status: 'belum_ada', value: null });
    expect(old.reason).toContain('hari ini');
  });

  it('is belum_ada when a depot summary is missing or unreadable', async () => {
    const a = build();
    a.depots.hrSummaryMany.mockImplementation(async (ids: string[]) => ids.map((depotId, i) => (i === 0 ? null : { depotId, activeHeadcount: 4 })));
    expect((await a.ask('H-01', 'SUPER_ADMIN', TODAY)).status).toBe('belum_ada');
    const b = build();
    b.depots.hrSummaryMany.mockImplementation(async (ids: string[]) => ids.map((depotId) => ({ depotId })));
    expect((await b.ask('H-01', 'SUPER_ADMIN', TODAY)).status).toBe('belum_ada');
  });

  it('is belum_ada when no depot is readable today (every stretch ended before)', async () => {
    const ended = scopeOf([span(D1, '2026-11-01', '2026-11-15')]);
    expect((await build(ended).ask('H-01', 'SUPER_ADMIN', TODAY)).status).toBe('belum_ada');
  });
});

describe('HrMetricsService: H-02 attendance', () => {
  it('adds the counts over each stretch a depot was readable, with the WIB calendar days asked for', async () => {
    const { sources, ask } = build();
    const out = await ask('H-02');
    // D1 has two stretches and D2 one: 3 depot-stretches of 20 present, 2 late, 1 absentRecorded, 1 leave
    expect(out.value).toMatchObject({ present: 60, late: 6, absentRecorded: 3, leave: 3, pending: 0, rate: { status: 'belum_ada' } });
    expect(out.value).not.toHaveProperty('flags');
    expect(out.value).not.toHaveProperty('absent');
    expect(out.label).toContain('BUKAN');
    const asked = sources.attendance.mock.calls.map((c) => `${(c[0] as string[]).join('+')}@${c[1]}..${c[2]}`).sort();
    expect(asked).toEqual([`${D1}@2026-11-01..2026-11-15`, `${D1}@2026-11-16..2026-11-30`, `${D2}@2026-11-01..2026-11-30`].sort());
  });

  it('holds back each count on its OWN distinct people: one person late is not a number even when many were present', async () => {
    const one = build(SCOPE, {
      attendance: async (ids: readonly string[]) => ({ rows: ids.map((d) => att(d)), heads: heads(5, { late: ['e1'], absentRecorded: [], leave: people(2) }), rolledUp: false }),
    });
    const out = await one.ask('H-02');
    expect(out.value).toMatchObject({ present: 60, late: null, leave: null });
    expect((out.value as { flags: Record<string, string> }).flags).toEqual({ late: 'kurang dari 3', leave: 'kurang dari 3' });
  });

  it('counts a person with records at two depots once: 2 people stay 2, they do not publish as 4', async () => {
    // every depot-stretch read reports the same two people on leave
    const out = await build(SCOPE, {
      attendance: async (ids: readonly string[]) => ({ rows: ids.map((d) => att(d)), heads: heads(5, { leave: ['e1', 'e2'] }), rolledUp: false }),
    }).ask('H-02');
    expect(out.value).toMatchObject({ leave: null, flags: { leave: 'kurang dari 3' } });
    // different people in different reads do add up: 2 + 1 distinct = 3
    let n = 0;
    const three = await build(SCOPE, {
      attendance: async (ids: readonly string[]) => ({ rows: ids.map((d) => att(d)), heads: heads(5, { leave: n++ === 0 ? ['e1', 'e2'] : ['e3'] }), rolledUp: false }),
    }).ask('H-02');
    expect(three.value).toMatchObject({ leave: 3 });
  });

  it('holds the whole answer when every count that has people is held, and answers a window without records as zeros', async () => {
    const tiny = build(SCOPE, { attendance: async (ids: readonly string[]) => ({ rows: ids.map((d) => att(d)), heads: heads(1, { pending: [] }), rolledUp: false }) });
    expect(await tiny.ask('H-02')).toMatchObject({ status: 'ditahan', value: null });
    const none = build(SCOPE, { attendance: async (ids: readonly string[]) => ({ rows: ids.map((d) => att(d, { present: 0, late: 0, absentRecorded: 0, leave: 0 })), heads: heads(0), rolledUp: false }) });
    expect((await none.ask('H-02')).value).toMatchObject({ present: 0, late: 0, leave: 0 });
  });

  it.each([
    ['a week', { period: 'week', date: '2026-11-10' }],
    ['a day', { period: 'day', date: '2026-11-10' }],
    ['a month less a day', { from: '2026-11-01', to: '2026-11-29' }],
    ['an arbitrary range', { from: '2026-11-05', to: '2026-12-20' }],
  ])('refuses %s (a month less a day would isolate one day) and never asks the source', async (_name, query) => {
    const b = build();
    const out = await b.ask('H-02', 'SUPER_ADMIN', query as Record<string, string>);
    expect(out).toMatchObject({ status: 'belum_ada', value: null });
    expect(out.reason).toContain('bulan atau tahun penuh');
    expect(b.sources.attendance).not.toHaveBeenCalled();
  });

  it('answers a whole year', async () => {
    expect((await build().ask('H-02', 'SUPER_ADMIN', { period: 'year', date: '2026-06-01' })).status).toBe('ok');
  });

  it('is belum_ada when old days were folded into monthly counts, or hr-service cannot answer', async () => {
    const folded = await build(SCOPE, { attendance: async () => ({ rows: [], heads: heads(0), rolledUp: true }) }).ask('H-02');
    expect(folded.status).toBe('belum_ada');
    expect(folded.reason).toContain('dirangkum');
    expect((await build(SCOPE, { attendance: async () => null }).ask('H-02')).status).toBe('belum_ada');
  });

  it('asks 100 depots at a time', async () => {
    const many = scopeOf(Array.from({ length: 150 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-11-01', '2026-11-30')));
    const { sources, ask } = build(many);
    await ask('H-02');
    expect(sources.attendance.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([100, 50]);
  });
});

describe('HrMetricsService: H-03, H-04, H-05 (finished month, payrollRead)', () => {
  it('totals the approved/paid slips of the depots readable on the LAST day of the month (D1 is PT_B then)', async () => {
    const { sources, ask } = build();
    const out = await ask('H-03', 'FINANCE');
    expect(out.value).toEqual({ slips: 8, grossIdr: 40_000_000, bonusIdr: 2_000_000, deductionIdr: 1_000_000, netIdr: 41_000_000 });
    expect(sources.payroll).toHaveBeenCalledWith([D1, D2], '2026-11');
    expect(out.scope.depotIds).toEqual([D1, D2]);
  });

  it('counts a depot that left a readable entity before the month ended out of the month (entity on the last day decides)', async () => {
    // D1 was readable only until 15 Nov: not the entity it had on 30 Nov
    const scope = scopeOf([span(D1, '2026-11-01', '2026-11-15'), span(D2, '2026-11-01', '2026-11-30', PT_B)]);
    const { sources, ask } = build(scope);
    const out = await ask('H-03');
    expect(sources.payroll).toHaveBeenCalledWith([D2], '2026-11');
    expect(out.scope.depotIds).toEqual([D2]);
    expect((out.value as { slips: number }).slips).toBe(4);
    expect((await build(scopeOf([span(D1, '2026-11-01', '2026-11-15')])).ask('H-03')).status).toBe('belum_ada');
  });

  it('keeps pay for the roles that may read payroll', async () => {
    for (const id of ['H-03', 'H-04', 'H-05']) {
      const out = await build().ask(id, 'KEPALA_DEPOT');
      expect(out).toMatchObject({ status: 'ditahan', value: null });
    }
  });

  it('is belum_ada while a depot has a DRAFT slip, an employee without a finished slip, or the gate is unreadable', async () => {
    const draft = build(SCOPE, { payrollGate: async (ids: readonly string[]) => ids.map((d, i) => gate(d, { draft: i === 0 ? 1 : 0 })) });
    const out = await draft.ask('H-03');
    expect(out.status).toBe('belum_ada');
    expect(out.reason).toContain('1 depot');
    expect(draft.sources.payroll).not.toHaveBeenCalled();
    const short = build(SCOPE, { payrollGate: async (ids: readonly string[]) => ids.map((d) => gate(d, { final: 3 })) });
    expect((await short.ask('H-04')).status).toBe('belum_ada');
    expect((await build(SCOPE, { payrollGate: async () => null }).ask('H-05')).status).toBe('belum_ada');
  });

  it('gates on the HOME depot basis the amounts use, asked of hr-service per month, not on the P&L gate', async () => {
    const b = build();
    await b.ask('H-03');
    expect(b.sources.payrollGate).toHaveBeenCalledWith([D1, D2], '2026-11');
    // H2's gate (hrSummaryMany, the live-depot basis of the P&L amounts) is not consulted by the HR metrics
    expect(b.depots.hrSummaryMany).not.toHaveBeenCalled();
  });

  it('holds the answer when it rests on 1 or 2 slips, and is belum_ada when no slip exists', async () => {
    const one = build(SCOPE, { payroll: async (ids: readonly string[]) => ids.map((d) => pay(d, { slips: d === D1 ? 1 : 0 })) });
    expect(await one.ask('H-03')).toMatchObject({ status: 'ditahan', value: null });
    const zero = build(SCOPE, { payroll: async (ids: readonly string[]) => ids.map((d) => pay(d, { slips: 0, gallonPeople: 0 })) });
    expect((await zero.ask('H-03')).status).toBe('belum_ada');
  });

  it('is belum_ada when hr-service cannot answer or the month is not a whole month', async () => {
    expect((await build(SCOPE, { payroll: async () => null }).ask('H-03')).status).toBe('belum_ada');
    await expect(build().ask('H-03', 'SUPER_ADMIN', { from: '2026-11-05', to: '2026-11-20' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(build().ask('H-03', 'SUPER_ADMIN', { from: '2026-10-01', to: '2026-11-30' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('H-05 is the gallon bonus, held under 3 recipients and 0 when nobody earned it', async () => {
    expect((await build().ask('H-05')).value).toBe(1_200_000);
    expect(await build(SCOPE, { payroll: async (ids: readonly string[]) => ids.map((d) => pay(d, { gallonPeople: d === D1 ? 2 : 0 })) }).ask('H-05')).toMatchObject({ status: 'ditahan' });
    expect(await build(SCOPE, { payroll: async (ids: readonly string[]) => ids.map((d) => pay(d, { gallonPeople: 0, gallonBonusIdr: 0 })) }).ask('H-05')).toMatchObject({ status: 'ok', value: 0 });
  });

  it('H-04 adds what is owed, leaves a depot of 1 or 2 borrowers out and says so, and holds all of it when every depot is that small', async () => {
    expect((await build().ask('H-04')).value).toEqual({ remainingIdr: 5_000_000, people: 8, heldBackDepots: 0 });
    const some = build(SCOPE, { kasbon: async (ids: readonly string[]) => ids.map((depotId) => ({ depotId, people: depotId === D1 ? 2 : 4, remainingIdr: 1_000_000 })) });
    expect((await some.ask('H-04')).value).toEqual({ remainingIdr: 1_000_000, people: 4, heldBackDepots: 1 });
    const tiny = build(SCOPE, { kasbon: async (ids: readonly string[]) => ids.map((depotId) => ({ depotId, people: 1, remainingIdr: 1 })) });
    expect(await tiny.ask('H-04')).toMatchObject({ status: 'ditahan' });
    const nobody = build(SCOPE, { kasbon: async (ids: readonly string[]) => ids.map((depotId) => ({ depotId, people: 0, remainingIdr: 0 })) });
    expect((await nobody.ask('H-04')).value).toEqual({ remainingIdr: 0, people: 0, heldBackDepots: 0 });
    expect((await build(SCOPE, { kasbon: async () => null }).ask('H-04')).status).toBe('belum_ada');
  });
});

describe('HrMetricsService: the rest', () => {
  it('answers overtime and turnover belum_ada, whoever asks', async () => {
    for (const id of ['H-06', 'H-07']) expect(await build().ask(id)).toMatchObject({ status: 'belum_ada', value: null });
  });

  it('says belum_ada with no readable depot and knows exactly its own ids', async () => {
    expect((await build(scopeOf([])).ask('H-02')).status).toBe('belum_ada');
    expect(HR_METRIC_IDS).toEqual(['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06', 'H-07']);
    await expect(build().ask('W-01')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build().ask('toString')).rejects.toBeInstanceOf(NotFoundException);
  });
});
