import { ServiceUnavailableException } from '@nestjs/common';

import { AuthenticatedUser } from '@hydromart/platform';

import { CumulativeScopeService, heldBackNote } from '../../src/application/ai-read/cumulative-scope.service';

/*
 * HD-6 H3: a metric that adds up ALL history may answer for a depot only if every legal-entity
 * stretch of that depot up to the as-of day is one the role may read. A depot that joined a readable
 * entity on 10 Nov must not expose what happened before.
 */
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const D3 = '33333333-3333-4333-8333-333333333333';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = { sub: 'u1', role: 'FINANCE', depotId: null } as unknown as AuthenticatedUser;

const service = (spans: unknown, grants: unknown) => {
  const sources = { entityTimeline: jest.fn(async () => spans), aiGrants: jest.fn(async () => grants) };
  return { sources, service: new CumulativeScopeService(sources as never) };
};
const TIMELINE = [
  { depotId: D1, legalEntityId: PT_B, from: '2020-01-01' }, // always readable
  { depotId: D2, legalEntityId: PT_A, from: '2020-01-01' }, // PT_A before, PT_B from 10 Nov
  { depotId: D2, legalEntityId: PT_B, from: '2026-11-10' },
  { depotId: D3, legalEntityId: PT_A, from: '2020-01-01' }, // never readable
];

describe('CumulativeScopeService', () => {
  it('lets through only the depots whose whole history is readable, and says since when the others are', async () => {
    const { service: s, sources } = service(TIMELINE, { all: false, legalEntityIds: [PT_B] });
    const r = await s.split(user, [D3, D1, D2, D1], '2026-11-25');
    expect(r.readable).toEqual([D1]);
    expect(r.heldBack).toEqual([
      { depotId: D2, since: '2026-11-10' },
      { depotId: D3, since: null },
    ]);
    expect(sources.entityTimeline).toHaveBeenCalledWith([D3, D1, D2, D1], '2000-01-01', '2026-11-25');
    expect(sources.aiGrants).toHaveBeenCalledWith('FINANCE');
  });

  it('a role granted everything reads every depot, and a depot with no recorded entity is held for anyone else', async () => {
    const all = service(TIMELINE, { all: true, legalEntityIds: [] });
    expect((await all.service.split(user, [D1, D2, D3], '2026-11-25')).readable).toEqual([D1, D2, D3]);
    const noEntity = service([{ depotId: D1, legalEntityId: null, from: '2020-01-01' }], { all: false, legalEntityIds: [PT_B] });
    expect((await noEntity.service.split(user, [D1], '2026-11-25')).heldBack).toEqual([{ depotId: D1, since: null }]);
    // no stretch recorded at all: nothing proves the history is readable
    const none = service([], { all: false, legalEntityIds: [PT_B] });
    expect((await none.service.split(user, [D1], '2026-11-25')).heldBack).toEqual([{ depotId: D1, since: null }]);
  });

  it('asks nothing for no depot, and fails closed when depot-service cannot say', async () => {
    const { service: s, sources } = service(TIMELINE, { all: true, legalEntityIds: [] });
    await expect(s.split(user, [], '2026-11-25')).resolves.toEqual({ readable: [], heldBack: [] });
    expect(sources.entityTimeline).not.toHaveBeenCalled();
    await expect(service(null, { all: true, legalEntityIds: [] }).service.split(user, [D1], '2026-11-25')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service(TIMELINE, null).service.split(user, [D1], '2026-11-25')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('words what was held back, naming the day the rest became readable', () => {
    expect(heldBackNote([])).toBe('');
    const one = heldBackNote([{ depotId: D2, since: '2026-11-10' }]);
    expect(one).toContain('1 depot ditahan');
    expect(one).toContain('2026-11-10');
    expect(heldBackNote([{ depotId: D2, since: '2026-11-10' }, { depotId: D1, since: '2026-11-12' }])).toContain('2026-11-10, 2026-11-12');
    expect(heldBackNote([{ depotId: D3, since: null }])).not.toContain('sejak');
  });
});
