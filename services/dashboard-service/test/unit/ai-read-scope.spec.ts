import { ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser, configureDepotScope, resetDepotScope } from '@hydromart/platform';

import { parsePeriod } from '../../src/application/ai-read/period';
import { ReadScopeService, covers, grantedRanges } from '../../src/application/ai-read/scope.service';
import {
  AiGrants,
  AiReadSourcesPort,
  DepotEntitySpan,
} from '../../src/application/ports/ai-read-sources.port';
import { DashboardSourcesPort } from '../../src/application/ports/dashboard-sources.port';
import { AiReadSourcesHttpAdapter } from '../../src/infrastructure/http/ai-read-sources.http.adapter';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const D3 = '33333333-3333-4333-8333-333333333333';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-25T03:00:00.000Z');
const NOVEMBER = parsePeriod({ period: 'month', date: '2026-11-10' }, NOW);

const user = (role: string, depotId: string | null = null): AuthenticatedUser =>
  ({ sub: 'u1', role, depotId }) as unknown as AuthenticatedUser;

class FakeSources implements AiReadSourcesPort {
  timeline: DepotEntitySpan[] | null = [];
  grants: Record<string, AiGrants | null> = {};
  asked: Array<{ depotIds: readonly string[]; from: string; to: string }> = [];
  async entityTimeline(depotIds: readonly string[], from: string, to: string) {
    this.asked.push({ depotIds, from, to });
    return this.timeline && this.timeline.filter((s) => depotIds.includes(s.depotId));
  }
  async aiGrants(role: string) {
    return role in this.grants ? this.grants[role] : { all: false, legalEntityIds: [] };
  }
}

describe('ReadScopeService (HD-6): depot scope first, then the legal-entity grants', () => {
  let sources: FakeSources;
  let network: Array<{ id: string }> | null;
  let service: ReadScopeService;

  beforeEach(() => {
    sources = new FakeSources();
    network = [{ id: D1 }, { id: D2 }, { id: D3 }];
    const depots = { allDepots: async () => network } as unknown as DashboardSourcesPort;
    service = new ReadScopeService(sources, depots);
    // MANAGER resolves to the depot they hang off.
    configureDepotScope(async () => [D2]);
    sources.timeline = [
      { depotId: D1, legalEntityId: PT_A, from: '2026-11-01' },
      { depotId: D2, legalEntityId: PT_B, from: '2026-11-01' },
      { depotId: D3, legalEntityId: null, from: '2026-11-01' },
    ];
  });
  afterEach(() => resetDepotScope());

  it('gives a network role the depots of the entities its role is granted, and nothing of the others', async () => {
    sources.grants.FINANCE = { all: false, legalEntityIds: [PT_A] };
    expect((await service.resolve(user('FINANCE'), NOVEMBER)).echo).toEqual({
      depotIds: [D1],
      legalEntityIds: [PT_A],
    });
  });

  it('gives SUPER_ADMIN every depot, one with no entity recorded included', async () => {
    sources.grants.SUPER_ADMIN = { all: true, legalEntityIds: [] };
    const scope = await service.resolve(user('SUPER_ADMIN'), NOVEMBER);
    expect(scope.echo).toEqual({ depotIds: [D1, D2, D3], legalEntityIds: [PT_A, PT_B] });
    expect(covers(scope, D3, '2026-11-15')).toBe(true);
  });

  it('gives a role with no grants nothing, not everything', async () => {
    const scope = await service.resolve(user('HEAD_OFFICE'), NOVEMBER);
    expect(scope).toMatchObject({ spans: [], echo: { depotIds: [], legalEntityIds: [] } });
    // the network list the scope had to read rides along, so the scope route does not read it twice
    expect(scope.network?.map((d) => d.id)).toHaveLength(3);
  });

  it("never widens the caller's own depots: a grant to another depot's entity adds nothing", async () => {
    sources.grants.MANAGER = { all: false, legalEntityIds: [PT_A, PT_B] };
    const scope = await service.resolve(user('MANAGER', D2), NOVEMBER);
    expect(scope.echo.depotIds).toEqual([D2]);
    expect(sources.asked[0].depotIds).not.toContain(D1);
  });

  it('holds a depot-locked role to its one depot', async () => {
    sources.grants.KEPALA_DEPOT = { all: false, legalEntityIds: [PT_A, PT_B] };
    expect((await service.resolve(user('KEPALA_DEPOT', D1), NOVEMBER)).echo.depotIds).toEqual([D1]);
    expect(sources.asked[0].depotIds).toEqual([D1]);
  });

  it('counts a depot that moved from a non-granted to a granted entity only from the move (10 Nov)', async () => {
    sources.timeline = [
      { depotId: D1, legalEntityId: PT_A, from: '2026-11-01' },
      { depotId: D1, legalEntityId: PT_B, from: '2026-11-10' },
    ];
    sources.grants.FINANCE = { all: false, legalEntityIds: [PT_B] };
    const scope = await service.resolve(user('FINANCE'), NOVEMBER);
    expect(scope.echo).toEqual({ depotIds: [D1], legalEntityIds: [PT_B] });
    expect(scope.spans).toEqual([{ depotId: D1, legalEntityId: PT_B, from: '2026-11-10', to: '2026-11-30' }]);
    expect(grantedRanges(scope, D1)).toHaveLength(1);
    expect(grantedRanges(scope, D2)).toEqual([]);
    expect(covers(scope, D1, '2026-11-09')).toBe(false);
    expect(covers(scope, D1, '2026-11-10')).toBe(true);
    expect(covers(scope, D1, '2026-11-30')).toBe(true);
    expect(covers(scope, D2, '2026-11-15')).toBe(false);
    expect(sources.asked[0]).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('ends a granted stretch the day before the next one, across a month boundary', async () => {
    sources.timeline = [
      { depotId: D1, legalEntityId: PT_A, from: '2026-11-01' },
      { depotId: D1, legalEntityId: PT_B, from: '2026-11-01'.replace('11-01', '12-01') },
      { depotId: D1, legalEntityId: PT_A, from: '2026-12-15' },
    ];
    sources.grants.FINANCE = { all: false, legalEntityIds: [PT_A] };
    const scope = await service.resolve(user('FINANCE'), parsePeriod({ from: '2026-11-01', to: '2026-12-31' }, NOW));
    expect(scope.spans.map((s) => [s.from, s.to])).toEqual([
      ['2026-11-01', '2026-11-30'],
      ['2026-12-15', '2026-12-31'],
    ]);
  });

  it('answers nothing, without asking depot-service, for an account with no depot at all', async () => {
    configureDepotScope(async () => []);
    expect((await service.resolve(user('SUPERVISOR'), NOVEMBER)).spans).toEqual([]);
    expect(sources.asked).toEqual([]);
  });

  it('fails closed when depot-service cannot say: timeline, grants, or the depot list', async () => {
    sources.grants.FINANCE = { all: false, legalEntityIds: [PT_A] };
    sources.timeline = null;
    await expect(service.resolve(user('FINANCE'), NOVEMBER)).rejects.toBeInstanceOf(ServiceUnavailableException);
    sources.timeline = [];
    sources.grants.FINANCE = null;
    await expect(service.resolve(user('FINANCE'), NOVEMBER)).rejects.toBeInstanceOf(ServiceUnavailableException);
    sources.grants.FINANCE = { all: false, legalEntityIds: [PT_A] };
    network = null;
    await expect(service.resolve(user('FINANCE'), NOVEMBER)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('AiReadSourcesHttpAdapter', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const config = { depotServiceUrl: 'http://depot.test', internalServiceKey: 'k' } as never;
  const adapter = new AiReadSourcesHttpAdapter(config);
  const json = (body: unknown, ok = true) =>
    ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response;
  afterEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  it('splits more than 100 depots over calls and joins the spans', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    fetchMock.mockImplementation(async (url) => {
      const asked = (new URL(String(url)).searchParams.get('depotIds') as string).split(',');
      return json({ spans: asked.map((depotId) => ({ depotId, legalEntityId: null, from: '2026-11-01' })) });
    });
    const spans = await adapter.entityTimeline(ids, '2026-11-01', '2026-11-30');
    expect(spans).toHaveLength(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)['x-internal-key']).toBe('k');
  });

  it('answers null for a refusal, a network error and a malformed body', async () => {
    fetchMock.mockResolvedValueOnce(json({}, false));
    expect(await adapter.entityTimeline([D1], '2026-11-01', '2026-11-30')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await adapter.aiGrants('FINANCE')).toBeNull();
    fetchMock.mockResolvedValueOnce(json({ spans: [{ depotId: D1 }] }));
    expect(await adapter.entityTimeline([D1], '2026-11-01', '2026-11-30')).toBeNull();
    fetchMock.mockResolvedValueOnce(json({ spans: 'x' }));
    expect(await adapter.entityTimeline([D1], '2026-11-01', '2026-11-30')).toBeNull();
    fetchMock.mockResolvedValueOnce(json({ all: 'yes', legalEntityIds: [] }));
    expect(await adapter.aiGrants('FINANCE')).toBeNull();
    fetchMock.mockResolvedValueOnce(json({ all: false, legalEntityIds: [1] }));
    expect(await adapter.aiGrants('FINANCE')).toBeNull();
  });

  it('reads the grants of a role by its key', async () => {
    fetchMock.mockResolvedValueOnce(json({ roleKey: 'C_X', all: false, legalEntityIds: [PT_A] }));
    expect(await adapter.aiGrants('C_X')).toEqual({ all: false, legalEntityIds: [PT_A] });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://depot.test/api/v1/legal-entities/internal/ai-grants/C_X',
    );
  });
});
