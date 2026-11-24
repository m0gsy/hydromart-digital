import { NotFoundException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { FRANCHISE_METRIC_IDS, FranchiseMetricsService } from '../../src/application/ai-read/franchise-metrics';
import { ReadScope, ReadScopeService } from '../../src/application/ai-read/scope.service';
import { AiOrgSourcesPort } from '../../src/application/ports/ai-org-sources.port';
import { AiReadSourcesPort } from '../../src/application/ports/ai-read-sources.port';
import { DashboardSourcesPort } from '../../src/application/ports/dashboard-sources.port';

/*
 * HD-6 H5, franchise and legal-entity metrics (dictionary 3.9). The sources are stubbed; what is under
 * test is the door each metric keeps, the masking of calon mitra counts, the HKP/waralaba split by the
 * entity a depot had ON THE DAY, and belum_ada / ditahan instead of a number.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const D3 = '33333333-3333-4333-8333-333333333333';
const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-25T03:00:00.000Z');
const NOVEMBER = { period: 'month', date: '2026-11-10' };

const user = (role: string): AuthenticatedUser => ({ sub: 'u1', role, depotId: null }) as unknown as AuthenticatedUser;
const span = (depotId: string, from: string, to: string, legalEntityId: string | null) => ({ depotId, legalEntityId, from, to });
const scopeOf = (spans: ReadScope['spans']): ReadScope => ({
  spans,
  echo: {
    depotIds: [...new Set(spans.map((s) => s.depotId))].sort(),
    legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort(),
  },
});
// D1 was a partner's (FR) until 15 Nov and the company's (OP) from 16 Nov; D2 stays the company's; D3 has no entity.
const SCOPE = scopeOf([
  span(D1, '2026-11-01', '2026-11-15', FR),
  span(D1, '2026-11-16', '2026-11-30', OP),
  span(D2, '2026-11-01', '2026-11-30', OP),
  span(D3, '2026-11-01', '2026-11-30', null),
]);
const KINDS = new Map([[OP, 'OPERATOR'], [FR, 'FRANCHISEE']]);

function build(scope: ReadScope = SCOPE, over: Partial<Record<keyof AiOrgSourcesPort, unknown>> = {}) {
  const sources: Record<string, jest.Mock> = {
    applications: jest.fn(async () => ({ total: 12, byStage: { PENDING: 5, DOC_VERIFICATION: 3, SURVEY: 2, APPROVED: 1, REJECTED: 1 } })),
    entityKinds: jest.fn(async () => KINDS),
    commission: jest.fn(async (ids: readonly string[]) => ids.map((depotId) => ({ depotId, commissionIdr: 10_000.4 }))),
    ...(over as Record<string, jest.Mock>),
  };
  const grants = { aiGrants: jest.fn(async () => ({ all: true, legalEntityIds: [] })) };
  const depots = {
    allDepots: jest.fn(async () => [
      { id: D1, code: 'D1', name: 'D1', active: true, ownershipType: 'HKP' },
      { id: D2, code: 'D2', name: 'D2', active: true, ownershipType: 'HKP' },
      { id: D3, code: 'D3', name: 'D3', active: false, ownershipType: 'WARALABA' },
    ]),
  };
  const scopes = { resolve: jest.fn(async () => scope) } as unknown as ReadScopeService;
  const service = new FranchiseMetricsService(
    scopes,
    sources as unknown as AiOrgSourcesPort,
    grants as unknown as AiReadSourcesPort,
    depots as unknown as DashboardSourcesPort,
  );
  const ask = (id: string, role = 'SUPER_ADMIN', query: Record<string, string> = NOVEMBER, now = NOW) => service.answer(id, user(role), query, now);
  return { sources, grants, depots, ask };
}

describe('FranchiseMetricsService: calon mitra (W-01, W-02)', () => {
  it('counts the applications of the period by their submit instants and gives the stages as they are now', async () => {
    const { sources, ask } = build();
    const w1 = await ask('W-01');
    expect(w1).toMatchObject({ status: 'ok', value: 12, unit: 'pengajuan' });
    expect(sources.applications).toHaveBeenCalledWith({ from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' });
    const w2 = await ask('W-02');
    expect(w2.value).toMatchObject({ total: 12, conversion: { status: 'belum_ada' } });
    expect(w2.label).toContain('tahap sekarang');
  });

  it('holds back a stage of fewer than 3 calon mitra and, beside the total, enough neighbours that it cannot be subtracted', async () => {
    const { ask } = build();
    const byStage = ((await ask('W-02')).value as { byStage: { stage: string; value: number | null; flag?: string }[] }).byStage;
    const flagged = byStage.filter((c) => c.flag);
    // SURVEY (2), APPROVED (1) and REJECTED (1) are too small; with 4 held, DOC_VERIFICATION (3) goes with them
    expect(flagged.map((c) => c.stage)).toEqual(['DOC_VERIFICATION', 'SURVEY', 'APPROVED', 'REJECTED']);
    expect(byStage.find((c) => c.stage === 'SURVEY')).toMatchObject({ value: null, flag: 'kurang dari 3' });
    expect(byStage.find((c) => c.stage === 'DOC_VERIFICATION')).toMatchObject({ value: null, flag: 'ditahan' });
    expect(byStage.find((c) => c.stage === 'PENDING')).toMatchObject({ value: 5 });
    expect(byStage.every((c) => c.flag || typeof c.value === 'number')).toBe(true);
  });

  it('holds the total itself back when no other cell can cover the small ones', async () => {
    const { ask } = build(SCOPE, { applications: async () => ({ total: 2, byStage: { PENDING: 1, SURVEY: 1 } }) });
    const w2 = (await ask('W-02')).value as { total: number | null; totalFlag: string };
    expect(w2).toMatchObject({ total: null, totalFlag: 'ditahan' });
  });

  it('holds a total of 1 or 2 calon mitra, answers 0 as 0, and passes a clean total', async () => {
    expect(await build(SCOPE, { applications: async () => ({ total: 2, byStage: { PENDING: 2 } }) }).ask('W-01')).toMatchObject({
      status: 'ditahan',
      value: null,
      reason: expect.stringContaining('kurang dari 3'),
    });
    expect(await build(SCOPE, { applications: async () => ({ total: 0, byStage: {} }) }).ask('W-01')).toMatchObject({ status: 'ok', value: 0 });
  });

  it('is belum_ada when the stages the service names do not add up to its total, or it names a stage it has no word for', async () => {
    expect((await build(SCOPE, { applications: async () => ({ total: 5, byStage: { PENDING: 1 } }) }).ask('W-02')).status).toBe('belum_ada');
    expect((await build(SCOPE, { applications: async () => ({ total: 1, byStage: { ARCHIVED: 1 } }) }).ask('W-01')).status).toBe('belum_ada');
  });

  it('is belum_ada when depot-service cannot answer, and for the grants it cannot read', async () => {
    expect((await build(SCOPE, { applications: async () => null }).ask('W-01')).status).toBe('belum_ada');
    const b = build();
    b.grants.aiGrants.mockResolvedValueOnce(null as never);
    expect((await b.ask('W-01')).status).toBe('belum_ada');
  });

  it('keeps its door: a role without the queue, and a role granted only some legal entities, get ditahan', async () => {
    const b = build();
    expect(await b.ask('W-01', 'FINANCE')).toMatchObject({ status: 'ditahan', value: null });
    b.grants.aiGrants.mockResolvedValueOnce({ all: false, legalEntityIds: [OP] } as never);
    expect(await b.ask('W-02', 'HEAD_OFFICE')).toMatchObject({ status: 'ditahan', value: null });
    expect(b.sources.applications).not.toHaveBeenCalled();
  });
});

describe('FranchiseMetricsService: W-03, W-04, W-05, W-06', () => {
  it('splits today\'s active depots by type, by the entity each had today (D1 is the company\'s from 16 Nov)', async () => {
    const { ask } = build();
    const out = await ask('W-03');
    expect(out.value).toEqual({
      depots: 2,
      byOwnershipType: { HKP: 2, WARALABA: 0 },
      byEntityKind: { HKP: 2, WARALABA: 0, INDUK: 0, TANPA_BADAN_HUKUM: 0 },
    });
    // the same question asked about a day D1 still belonged to the partner is not a today question
    expect((await ask('W-03', 'SUPER_ADMIN', { from: '2026-11-01', to: '2026-11-15' })).status).toBe('belum_ada');
  });

  it('counts a depot with no entity and an inactive depot correctly, and a franchisor as INDUK', async () => {
    const scope = scopeOf([span(D1, '2026-11-01', '2026-11-30', FR), span(D2, '2026-11-01', '2026-11-30', null), span(D3, '2026-11-01', '2026-11-30', OP)]);
    const b = build(scope, { entityKinds: async () => new Map([[FR, 'FRANCHISEE'], [OP, 'FRANCHISOR']]) });
    b.depots.allDepots.mockResolvedValue([
      { id: D1, code: 'D1', name: 'D1', active: true, ownershipType: 'WARALABA' },
      { id: D2, code: 'D2', name: 'D2', active: true, ownershipType: 'HKP' },
      { id: D3, code: 'D3', name: 'D3', active: true, ownershipType: 'HKP' },
    ]);
    expect((await b.ask('W-03')).value).toEqual({
      depots: 3,
      byOwnershipType: { HKP: 2, WARALABA: 1 },
      byEntityKind: { HKP: 0, WARALABA: 1, INDUK: 1, TANPA_BADAN_HUKUM: 1 },
    });
  });

  it('files an entity kind it has no business word for under TANPA_BADAN_HUKUM, and fails closed on a source that is down', async () => {
    const b = build(SCOPE, { entityKinds: async () => new Map([[OP, 'SOMETHING_NEW']]) });
    expect(((await b.ask('W-03')).value as { byEntityKind: Record<string, number> }).byEntityKind.TANPA_BADAN_HUKUM).toBe(2);
    expect((await build(SCOPE, { entityKinds: async () => null }).ask('W-03')).status).toBe('belum_ada');
    const down = build();
    down.depots.allDepots.mockResolvedValueOnce(null as never);
    expect((await down.ask('W-03')).status).toBe('belum_ada');
  });

  it('holds hak mitra back, whoever asks', async () => {
    const out = await build().ask('W-04');
    expect(out).toMatchObject({ status: 'ditahan', value: null, unit: 'Rp' });
    expect(out.reason).toContain('31A');
  });

  it('adds HQ commission over each stretch the depot was readable and rounds to the rupiah', async () => {
    const { sources, ask } = build();
    const out = await ask('W-05');
    // D1 has two stretches, D2 and D3 whole month: 4 depot-stretches of 10_000.4 each
    expect(out.value).toBe(40_002);
    const windows = sources.commission.mock.calls.map((c) => `${(c[0] as string[]).join('+')}@${(c[1] as { from: string }).from}`).sort();
    expect(windows).toEqual(
      [`${D1}@2026-10-31T17:00:00.000Z`, `${D1}@2026-11-15T17:00:00.000Z`, `${D2}+${D3}@2026-10-31T17:00:00.000Z`].sort(),
    );
  });

  it('keeps W-05 to the roles that read partner payouts, and says belum_ada when payout-service fails', async () => {
    expect((await build().ask('W-05', 'KEPALA_DEPOT')).status).toBe('ditahan');
    expect((await build(SCOPE, { commission: async () => null }).ask('W-05')).status).toBe('belum_ada');
    expect((await build(scopeOf([])).ask('W-05')).status).toBe('belum_ada');
  });

  it('names the entity each depot had on the LAST day of the period, and which depots moved in it', async () => {
    const { ask } = build();
    const out = await ask('W-06');
    expect(out.value).toEqual([
      { depotId: D1, legalEntityId: OP, kind: 'OPERATOR', changedInPeriod: true },
      { depotId: D2, legalEntityId: OP, kind: 'OPERATOR', changedInPeriod: false },
      { depotId: D3, legalEntityId: null, kind: null, changedInPeriod: false },
    ]);
    // 15 Nov 23:59 WIB is still the partner's, 16 Nov is the company's: a day of its own decides
    const before = await ask('W-06', 'SUPER_ADMIN', { period: 'day', date: '2026-11-15' });
    expect((before.value as { legalEntityId: string; kind: string }[])[0]).toMatchObject({ legalEntityId: FR, kind: 'FRANCHISEE' });
    const after = await ask('W-06', 'SUPER_ADMIN', { period: 'day', date: '2026-11-16' });
    expect((after.value as { legalEntityId: string }[])[0].legalEntityId).toBe(OP);
  });

  it('is belum_ada for W-06 when nothing is readable that day, the kinds cannot be read, or the list would be cut', async () => {
    const { ask } = build();
    expect((await ask('W-06', 'SUPER_ADMIN', { period: 'day', date: '2026-12-15' })).status).toBe('belum_ada');
    expect((await build(SCOPE, { entityKinds: async () => null }).ask('W-06')).status).toBe('belum_ada');
    const many = scopeOf(Array.from({ length: 1001 }, (_, i) => span(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, '2026-11-01', '2026-11-30', null)));
    expect((await build(many).ask('W-06')).status).toBe('belum_ada');
  });

  it('says belum_ada with no readable depot, for the depot-bound metrics', async () => {
    const empty = scopeOf([]);
    for (const id of ['W-03', 'W-06']) expect((await build(empty).ask(id)).status).toBe('belum_ada');
  });

  it('knows exactly its own ids, and an id outside the group is a 404', async () => {
    expect(FRANCHISE_METRIC_IDS).toEqual(['W-01', 'W-02', 'W-03', 'W-04', 'W-05', 'W-06']);
    await expect(build().ask('P-01')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build().ask('constructor')).rejects.toBeInstanceOf(NotFoundException);
  });
});
