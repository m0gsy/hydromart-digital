import { Logger } from '@nestjs/common';

import { DashboardConfigService } from '../../src/config/dashboard-config.service';
import { AiOrgSourcesHttpAdapter } from '../../src/infrastructure/http/ai-org-sources.http.adapter';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const E1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RANGE = { from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' };

function adapter(wired = true) {
  const config = {
    depotServiceUrl: 'http://depot.test',
    hrServiceUrl: wired ? 'http://hr.test' : undefined,
    payoutServiceUrl: wired ? 'http://payout.test' : undefined,
    internalServiceKey: 'k',
  } as unknown as DashboardConfigService;
  return new AiOrgSourcesHttpAdapter(config);
}

function answer(body: unknown, ok = true) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    if (body === 'throw') throw new Error('network down');
    return { ok, status: ok ? 200 : 503, json: async () => body } as unknown as Response;
  });
  return calls;
}

afterEach(() => jest.restoreAllMocks());

const NONE = { late: [], absentRecorded: [], leave: [], pending: [], scheduledDays: [], attendedScheduled: [], absentScheduled: [], unscheduledDays: [] };

describe('AiOrgSourcesHttpAdapter (HD-6 H5)', () => {
  it('never logs a response body: the employee ids in an attendance answer stay out of every log line', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const body = { rows: [], heads: { present: ['EMPLOYEE-ID-1'], ...NONE }, rolledUp: false };
    answer(body, false); // refused
    await adapter().attendance([D1], '2026-11-01', '2026-11-30');
    answer(body); // a malformed (short) answer
    await adapter().attendance([D1], '2026-11-01', '2026-11-30');
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    await adapter().attendance([D1], '2026-11-01', '2026-11-30');
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain('EMPLOYEE-ID');
      expect(String(call[0])).not.toContain(D1); // nor the query
    }
    warn.mockRestore();
  });

  it('asks depot-service for the applications of a window, with the internal key', async () => {
    const calls = answer({ total: 3, byStage: { PENDING: 2, REJECTED: 1 } });
    await expect(adapter().applications(RANGE)).resolves.toEqual({ total: 3, byStage: { PENDING: 2, REJECTED: 1 } });
    expect(calls[0].url.pathname).toBe('/api/v1/franchise-applications/internal/summary');
    expect(calls[0].url.searchParams.get('from')).toBe(RANGE.from);
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it.each([
    ['a failed call', { total: 1, byStage: {} }, false],
    ['an unreachable service', 'throw', true],
    ['no total', { byStage: {} }, true],
    ['no stages', { total: 1 }, true],
    ['a stage count that is not a number', { total: 1, byStage: { PENDING: '1' } }, true],
  ])('reads no applications from %s', async (_name, body, ok) => {
    answer(body, ok as boolean);
    await expect(adapter().applications(RANGE)).resolves.toBeNull();
  });

  it('maps the kinds of the entities asked for, and is null when one is unknown or the answer is malformed', async () => {
    const calls = answer({ entities: [{ id: E1, kind: 'OPERATOR' }] });
    await expect(adapter().entityKinds([E1.toUpperCase()])).resolves.toEqual(new Map([[E1, 'OPERATOR']]));
    expect(calls[0].url.pathname).toBe('/api/v1/legal-entities/internal/kinds');
    answer({ entities: [] });
    await expect(adapter().entityKinds([E1])).resolves.toBeNull();
    answer({ entities: [{ id: E1 }] });
    await expect(adapter().entityKinds([E1])).resolves.toBeNull();
    answer({});
    await expect(adapter().entityKinds([E1])).resolves.toBeNull();
    const none = answer({});
    await expect(adapter().entityKinds([])).resolves.toEqual(new Map());
    expect(none).toHaveLength(0);
  });

  it('asks for the kinds of more than 100 entities in parts of 100, and is null if any part fails or is short', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`);
    const calls: URL[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      const asked = (url.searchParams.get('ids') ?? '').split(',');
      return { ok: true, status: 200, json: async () => ({ entities: asked.map((id) => ({ id, kind: 'OPERATOR' })) }) } as unknown as Response;
    });
    const kinds = await adapter().entityKinds(ids);
    expect(kinds?.size).toBe(150);
    expect(calls.map((u) => (u.searchParams.get('ids') ?? '').split(',').length)).toEqual([100, 50]);
    jest.restoreAllMocks();
    answer({ entities: [] });
    await expect(adapter().entityKinds(ids)).resolves.toBeNull();
  });

  it('asks payout-service for HQ commission per depot and accepts exactly the depots asked', async () => {
    const calls = answer([{ depotId: D1, commissionIdr: 5 }, { depotId: D2, commissionIdr: 0 }]);
    await expect(adapter().commission([D1, D2], RANGE)).resolves.toHaveLength(2);
    expect(calls[0].url.pathname).toBe('/api/v1/payout/internal/commission-by-depot');
    expect(calls[0].url.searchParams.get('depotIds')).toBe(`${D1},${D2}`);
    for (const body of [
      [{ depotId: D1, commissionIdr: 5 }], // short
      [{ depotId: D1, commissionIdr: 5 }, { depotId: D1, commissionIdr: 5 }], // the same depot twice
      [{ depotId: D1, commissionIdr: 5 }, { depotId: 'other', commissionIdr: 5 }], // not asked
      [{ depotId: D1, commissionIdr: 5 }, { depotId: D2, commissionIdr: '0' }], // not a number
      { rows: [] },
    ]) {
      answer(body);
      await expect(adapter().commission([D1, D2], RANGE)).resolves.toBeNull();
    }
    await expect(adapter(false).commission([D1], RANGE)).resolves.toBeNull();
  });

  it('reads hr-service attendance, payroll and kasbon, one row per depot, and nothing from an unwired service', async () => {
    const att = { depotId: D1, present: 1, late: 0, absentRecorded: 0, leave: 0, pending: 0, scheduledDays: 1, attendedScheduled: 1, absentScheduled: 0, unscheduledDays: 0 };
    const heads = { present: ['e1'], ...NONE };
    const calls = answer({ rows: [att], heads, rolledUp: false });
    await expect(adapter().attendance([D1], '2026-11-01', '2026-11-30')).resolves.toEqual({ rows: [att], heads, rolledUp: false });
    expect(calls[0].url.pathname).toBe('/api/v1/hr-reports/internal/ai/attendance');
    expect(calls[0].url.searchParams.get('to')).toBe('2026-11-30');
    for (const body of [
      { rows: [att], heads }, // no rolledUp
      { rows: [att], rolledUp: false }, // no heads
      { rows: [att], heads: { ...heads, late: 'x' }, rolledUp: false }, // heads not lists
      { rows: [att], heads: { ...heads, late: [1] }, rolledUp: false }, // ids not strings
      { rows: [{ ...att, present: undefined }], heads, rolledUp: false },
      { rows: [{ ...att, scheduledDays: undefined }], heads, rolledUp: false }, // an hr-service without the scheduled days
      { rows: [att], heads: { present: ['e1'] }, rolledUp: false },
    ]) {
      answer(body);
      await expect(adapter().attendance([D1], '2026-11-01', '2026-11-30')).resolves.toBeNull();
    }

    const gateRow = { depotId: D1, expected: 4, draft: 0, final: 4 };
    const gates = answer([gateRow]);
    await expect(adapter().payrollGate([D1], '2026-11')).resolves.toEqual([gateRow]);
    expect(gates[0].url.pathname).toBe('/api/v1/hr-reports/internal/ai/payroll-gate');
    answer([{ depotId: D1, expected: 4 }]);
    await expect(adapter().payrollGate([D1], '2026-11')).resolves.toBeNull();
    await expect(adapter(false).payrollGate([D1], '2026-11')).resolves.toBeNull();

    const slip = { depotId: D1, slips: 1, grossIdr: 1, bonusIdr: 1, deductionIdr: 1, netIdr: 1, gallonBonusIdr: 1, gallonPeople: 1 };
    const pay = answer([slip]);
    await expect(adapter().payroll([D1], '2026-11')).resolves.toEqual([slip]);
    expect(pay[0].url.pathname).toBe('/api/v1/hr-reports/internal/ai/payroll');
    expect(pay[0].url.searchParams.get('month')).toBe('2026-11');
    answer([{ ...slip, gallonPeople: null }]);
    await expect(adapter().payroll([D1], '2026-11')).resolves.toBeNull();

    const loan = { depotId: D1, people: 2, remainingIdr: 10 };
    const kas = answer([loan]);
    await expect(adapter().kasbon([D1], '2026-11')).resolves.toEqual([loan]);
    expect(kas[0].url.pathname).toBe('/api/v1/hr-reports/internal/ai/kasbon');
    answer([]);
    await expect(adapter().kasbon([D1], '2026-11')).resolves.toBeNull();

    // HD-16: the month targets of every depot asked, in one read
    const tgt = { depotId: D1, revenueTargetIdr: 5, ordersTarget: 1, newCustomersTarget: 2, gallonsTarget: 3 };
    const t = answer([tgt]);
    await expect(adapter().depotTargets([D1], '2026-11')).resolves.toEqual([tgt]);
    expect(t[0].url.pathname).toBe('/api/v1/depot-targets/internal/by-month');
    expect(t[0].url.searchParams.get('month')).toBe('2026-11');
    expect(t).toHaveLength(1);
    answer([{ ...tgt, gallonsTarget: undefined }]); // a depot-service that predates the gallons target
    await expect(adapter().depotTargets([D1], '2026-11')).resolves.toBeNull();
    answer([]);
    await expect(adapter().depotTargets([D1], '2026-11')).resolves.toBeNull();

    const off = answer([att]);
    await expect(adapter(false).attendance([D1], '2026-11-01', '2026-11-30')).resolves.toBeNull();
    await expect(adapter(false).payroll([D1], '2026-11')).resolves.toBeNull();
    await expect(adapter(false).kasbon([D1], '2026-11')).resolves.toBeNull();
    expect(off).toHaveLength(0);
  });
});
