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

describe('AiOrgSourcesHttpAdapter (HD-6 H5)', () => {
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
    const att = { depotId: D1, present: 1, late: 0, absent: 0, leave: 0, pending: 0, people: 1 };
    const calls = answer({ rows: [att], rolledUp: false });
    await expect(adapter().attendance([D1], '2026-11-01', '2026-11-30')).resolves.toEqual({ rows: [att], rolledUp: false });
    expect(calls[0].url.pathname).toBe('/api/v1/hr-reports/internal/ai/attendance');
    expect(calls[0].url.searchParams.get('to')).toBe('2026-11-30');
    answer({ rows: [att] });
    await expect(adapter().attendance([D1], '2026-11-01', '2026-11-30')).resolves.toBeNull();
    answer({ rows: [{ ...att, people: undefined }], rolledUp: false });
    await expect(adapter().attendance([D1], '2026-11-01', '2026-11-30')).resolves.toBeNull();

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

    const off = answer([att]);
    await expect(adapter(false).attendance([D1], '2026-11-01', '2026-11-30')).resolves.toBeNull();
    await expect(adapter(false).payroll([D1], '2026-11')).resolves.toBeNull();
    await expect(adapter(false).kasbon([D1], '2026-11')).resolves.toBeNull();
    expect(off).toHaveLength(0);
  });
});
