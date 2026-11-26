import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QualityHoldService } from '../../src/application/services/quality-hold.service';
import { ComplianceSource, QualityHoldRepository } from '../../src/application/ports/quality-hold.repository';
import {
  DepotNotFoundError,
  LabTestDatesError,
  QualityHoldAlreadyActiveError,
  QualityHoldNotActiveError,
  QualityHoldRetestRequiredError,
} from '../../src/domain/errors';
import {
  endsHold,
  holdFlag,
  isRealDay,
  LAB_CLOCK_STARTS_ON,
  LabTest,
  labTestsDue,
  noHold,
  Permit,
  permitsDue,
  QualityHold,
  qualityHoldChanged,
} from '../../src/domain/quality-hold';
import { QualityHoldPrismaRepository } from '../../src/infrastructure/prisma/quality-hold.prisma.repository';
import { ComplianceInternalController } from '../../src/modules/compliance-internal.controller';
import { QualityHoldController } from '../../src/modules/quality-hold.controller';
import { PublicDepotView } from '../../src/modules/dto/depot.dto';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const D1 = '00000000-0000-4000-8000-0000000000d1';
const D2 = '00000000-0000-4000-8000-0000000000d2';
const HOLD = '00000000-0000-4000-8000-0000000000a1';
const TEST = '00000000-0000-4000-8000-0000000000b1';
const ACTOR = '00000000-0000-4000-8000-0000000000c1';
// 2026-11-20 10:00 WIB = 03:00 UTC.
const START = new Date('2026-11-20T03:00:00Z');

const hold = (over: Partial<QualityHold> = {}): QualityHold => ({
  id: HOLD,
  depotId: D1,
  status: 'ACTIVE',
  reasonCode: 'LAB_FAIL',
  note: 'rahasia',
  startedBy: ACTOR,
  startedAt: START,
  endedBy: null,
  endedAt: null,
  endRetestId: null,
  ...over,
});
const test = (over: Partial<LabTest> = {}): LabTest => ({
  id: TEST,
  depotId: D1,
  kind: 'LENGKAP',
  takenOn: '2026-11-21',
  resultOn: '2026-11-22',
  result: 'PASS',
  labName: 'Lab A',
  reportNo: 'R-1',
  recordedBy: ACTOR,
  recordedByRole: 'KEPALA_DEPOT',
  createdAt: START,
  ...over,
});

describe('quality hold domain', () => {
  it('the event carries ids, status and time only, one row per (hold, status)', () => {
    const e = qualityHoldChanged(HOLD, D1, 'ACTIVE', START);
    expect(e).toEqual({
      event: 'depot.quality_hold_changed',
      eventId: `depot.quality_hold_changed:${HOLD}:ACTIVE`,
      payload: { depotId: D1, status: 'ACTIVE', changedAt: START.toISOString() },
      occurredAt: START,
    });
    expect(JSON.stringify(e)).not.toMatch(/rahasia|LAB_FAIL/);
  });

  it('matches the contract the AI web codes against', () => {
    const contract = JSON.parse(readFileSync(join(__dirname, '../../../../contracts/ai-v1/events.openapi.json'), 'utf8'));
    const data = contract.components.schemas.DepotQualityHoldChangedData;
    const payload = qualityHoldChanged(HOLD, D1, 'ENDED', START).payload;
    expect(Object.keys(payload).sort()).toEqual([...data.required].sort());
    expect(data.properties.status.enum).toEqual(['ACTIVE', 'ENDED']);
  });

  it('flags a hold with its start day and nothing else', () => {
    expect(holdFlag(null)).toBe(noHold);
    expect(holdFlag(undefined)).toBe(noHold);
    expect(holdFlag(START)).toEqual({ active: true, since: START.toISOString() });
  });

  it('ends only on a PASS of the same depot taken on or after the hold start day (WIB)', () => {
    const h = hold();
    expect(endsHold(h, test())).toBe(true);
    expect(endsHold(h, test({ takenOn: '2026-11-20' }))).toBe(true);
    expect(endsHold(h, test({ takenOn: '2026-11-19' }))).toBe(false);
    expect(endsHold(h, test({ result: 'FAIL' }))).toBe(false);
    expect(endsHold(h, test({ depotId: D2 }))).toBe(false);
    expect(endsHold(h, null)).toBe(false);
    // 2026-11-19 23:00 UTC is already 20 Nov in WIB: a 20 Nov test counts, a 19 Nov test does not.
    expect(endsHold(hold({ startedAt: new Date('2026-11-19T23:00:00Z') }), test({ takenOn: '2026-11-19' }))).toBe(false);
  });

  it('knows a real day from a shaped one', () => {
    expect(isRealDay('2026-02-28')).toBe(true);
    expect(isRealDay('2026-02-31')).toBe(false);
    expect(isRealDay('2026-13-01')).toBe(false);
  });

  describe('lab tests due', () => {
    const depot = { id: D1, name: 'Cikini', createdOn: '2026-12-01' };
    it('never tested: the clock starts the day the depot was added', () => {
      const due = labTestsDue(depot, [], '2027-01-01');
      expect(due.map((i) => i.name)).toEqual(['Uji fisik dan mikrobiologi']);
      expect(due[0]).toMatchObject({ kind: 'LAB_TEST', dueOn: '2026-12-31', daysLeft: -1, cycleStart: '2026-12-01', depotName: 'Cikini' });
      expect(labTestsDue(depot, [], '2026-12-30')).toEqual([]);
    });
    it('never starts before launch: an old depot is not overdue on day one', () => {
      const old = { id: D1, name: 'Lama', createdOn: '2020-01-01' };
      expect(labTestsDue(old, [], '2026-11-27')).toEqual([]);
      expect(labTestsDue(old, [{ kind: 'ECOLI', takenOn: '2025-01-01' }], '2026-12-26')).toEqual([]);
      const first = labTestsDue(old, [], '2026-12-27');
      expect(first.map((i) => i.name)).toEqual(['Uji fisik dan mikrobiologi']);
      expect(first[0]).toMatchObject({ cycleStart: LAB_CLOCK_STARTS_ON, dueOn: '2026-12-27', daysLeft: 0 });
      // 90 and 180 days after launch the other two kinds follow.
      expect(labTestsDue(old, [], '2027-02-25').map((i) => i.name)).toEqual(['Uji fisik dan mikrobiologi', 'Uji E. coli']);
      expect(labTestsDue(old, [], '2027-05-26')).toHaveLength(3);
    });
    it('each kind has its own interval and a full panel counts for all three', () => {
      const tests = [{ kind: 'ECOLI' as const, takenOn: '2026-12-01' }, { kind: 'FISIK_MIKRO' as const, takenOn: '2027-03-10' }];
      const names = labTestsDue(depot, tests, '2027-03-20').map((i) => i.name);
      expect(names).toEqual(['Uji E. coli']);
      expect(labTestsDue(depot, [...tests, { kind: 'LENGKAP' as const, takenOn: '2027-03-19' }], '2027-03-20')).toEqual([]);
    });
    it('uses the latest test of a kind and gives each kind a distinct stable id', () => {
      const a = labTestsDue(depot, [{ kind: 'FISIK_MIKRO', takenOn: '2027-01-05' }, { kind: 'FISIK_MIKRO', takenOn: '2027-01-02' }], '2027-02-10');
      const b = labTestsDue(depot, [], '2028-01-01');
      expect(a.find((i) => i.name.includes('fisik'))?.cycleStart).toBe('2027-01-05');
      expect(new Set(b.map((i) => i.id)).size).toBe(3);
      expect(b[0].id).toBe(labTestsDue(depot, [], '2028-06-01')[0].id);
    });
  });

  describe('permits due', () => {
    const depot = { id: D1, name: 'Cikini' };
    const permit = (id: string, kind: string, validUntil: string) => ({ id, kind, number: `N-${id}`, validUntil });
    it('reminds from 30 days before, and after expiry', () => {
      expect(permitsDue(depot, [permit('p1', 'SLHS', '2026-12-31')], '2026-12-01')[0]).toMatchObject({
        id: 'p1', kind: 'PERMIT', name: 'SLHS N-p1', dueOn: '2026-12-31', daysLeft: 30, cycleStart: '2026-12-31',
      });
      expect(permitsDue(depot, [permit('p1', 'SLHS', '2026-12-31')], '2026-11-30')).toEqual([]);
      expect(permitsDue(depot, [permit('p1', 'SLHS', '2026-11-01')], '2026-11-30')[0].daysLeft).toBe(-29);
    });
    it('a renewal of the same kind supersedes the old permit', () => {
      const rows = [permit('old', 'SLHS', '2026-12-01'), permit('new', 'SLHS', '2027-12-01'), permit('other', 'NIB', '2026-12-05')];
      expect(permitsDue(depot, rows, '2026-11-30').map((i) => i.id)).toEqual(['other']);
    });
  });
});

function fakeRepo(over: Partial<QualityHoldRepository> = {}): jest.Mocked<QualityHoldRepository> {
  return {
    start: jest.fn(async (d) => hold({ depotId: d.depotId, reasonCode: d.reasonCode, note: d.note })),
    end: jest.fn(async () => hold({ status: 'ENDED', endedBy: ACTOR, endRetestId: TEST })),
    findActive: jest.fn(async () => hold()),
    history: jest.fn(async () => [hold()]),
    addLabTest: jest.fn(async (d) => test({ ...d })),
    findLabTest: jest.fn(async () => test()),
    listLabTests: jest.fn(async () => [test()]),
    addPermit: jest.fn(async (d) => ({ id: 'p', createdAt: START, ...d }) as Permit),
    listPermits: jest.fn(async () => []),
    complianceSource: jest.fn(async (): Promise<ComplianceSource> => ({ depots: [], tests: [], permits: [] })),
    ...over,
  } as jest.Mocked<QualityHoldRepository>;
}

function build(over: Partial<QualityHoldRepository> = {}, depotExists = true) {
  const repo = fakeRepo(over);
  const relay = { flush: jest.fn(async () => undefined) };
  const depots = { exists: jest.fn(async () => depotExists) };
  const service = new QualityHoldService(repo, depots as never, relay as never);
  return { service, repo, relay, depots };
}

describe('QualityHoldService', () => {
  it('starts a hold, trims the note and flushes the event', async () => {
    const { service, repo, relay } = build();
    await service.start(D1, { reasonCode: 'LAB_FAIL', note: '  keruh  ' }, ACTOR, START);
    expect(repo.start).toHaveBeenCalledWith({ depotId: D1, reasonCode: 'LAB_FAIL', note: 'keruh', startedBy: ACTOR, at: START });
    expect(relay.flush).toHaveBeenCalledWith(`depot.quality_hold_changed:${HOLD}:ACTIVE`);
    await service.start(D1, { reasonCode: 'OTHER' }, ACTOR);
    expect(repo.start).toHaveBeenLastCalledWith(expect.objectContaining({ note: null }));
  });

  it('refuses a second ACTIVE hold, an unknown depot', async () => {
    await expect(build({ start: jest.fn(async () => null) }).service.start(D1, { reasonCode: 'OTHER' }, ACTOR)).rejects.toBeInstanceOf(QualityHoldAlreadyActiveError);
    await expect(build({}, false).service.start(D1, { reasonCode: 'OTHER' }, ACTOR)).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('ends on a PASS retest, flushes the ENDED event', async () => {
    const { service, repo, relay } = build();
    const ended = await service.end(D1, TEST, ACTOR, START);
    expect(ended.status).toBe('ENDED');
    expect(repo.end).toHaveBeenCalledWith({ depotId: D1, endedBy: ACTOR, endRetestId: TEST, at: START });
    expect(relay.flush).toHaveBeenCalledWith(`depot.quality_hold_changed:${HOLD}:ENDED`);
  });

  it('never ends without a qualifying PASS (a FAIL, an old test, another depot, none)', async () => {
    for (const t of [test({ result: 'FAIL' }), test({ takenOn: '2026-11-01' }), test({ depotId: D2 }), null]) {
      const { service, repo } = build({ findLabTest: jest.fn(async () => t) });
      await expect(service.end(D1, TEST, ACTOR)).rejects.toBeInstanceOf(QualityHoldRetestRequiredError);
      expect(repo.end).not.toHaveBeenCalled();
    }
  });

  it('refuses to end a depot that has no hold, or one somebody else just ended', async () => {
    await expect(build({ findActive: jest.fn(async () => null) }).service.end(D1, TEST, ACTOR)).rejects.toBeInstanceOf(QualityHoldNotActiveError);
    await expect(build({ end: jest.fn(async () => null) }).service.end(D1, TEST, ACTOR)).rejects.toBeInstanceOf(QualityHoldNotActiveError);
  });

  it('records lab tests and permits with real, non-future days only', async () => {
    const { service, repo } = build();
    const actor = { id: ACTOR, role: 'KEPALA_DEPOT' };
    // 2026-11-30 10:00 WIB
    const now = new Date('2026-11-30T03:00:00Z');
    const input = { depotId: D1, kind: 'ECOLI' as const, takenOn: '2026-11-20', resultOn: '2026-11-21', result: 'PASS' as const, labName: 'Lab', reportNo: '1' };
    await service.addLabTest(input, actor, now);
    expect(repo.addLabTest).toHaveBeenCalledWith({ ...input, recordedBy: ACTOR, recordedByRole: 'KEPALA_DEPOT' });
    await service.addLabTest({ ...input, takenOn: '2026-11-30', resultOn: '2026-11-30' }, actor, now);
    for (const bad of [{ resultOn: '2026-11-19' }, { takenOn: '2026-02-31' }, { resultOn: '2026-13-40' }, { takenOn: '2030-01-01', resultOn: '2030-01-01' }, { resultOn: '2026-12-01' }]) {
      await expect(service.addLabTest({ ...input, ...bad }, actor, now)).rejects.toBeInstanceOf(LabTestDatesError);
    }
    await service.addLabTest(input, actor);
    await service.addPermit({ depotId: D1, kind: 'SLHS', number: '1', validUntil: '2027-01-01' }, ACTOR);
    await expect(service.addPermit({ depotId: D1, kind: 'SLHS', number: '1', validUntil: '2027-02-30' }, ACTOR)).rejects.toBeInstanceOf(LabTestDatesError);
    expect(await service.history(D1)).toHaveLength(1);
    expect(await service.listLabTests(D1)).toHaveLength(1);
    expect(await service.listPermits(D1)).toEqual([]);
  });

  it('computes what is due across active depots', async () => {
    const { service } = build({
      complianceSource: jest.fn(async () => ({
        depots: [{ id: D1, name: 'Cikini', createdAt: new Date('2026-01-01T03:00:00Z') }],
        tests: [{ depotId: D1, kind: 'LENGKAP' as const, takenOn: '2026-11-25' }, { depotId: D2, kind: 'ECOLI' as const, takenOn: '2020-01-01' }],
        permits: [{ id: 'p1', depotId: D1, kind: 'SLHS', number: '9', validUntil: '2026-12-10', recordedBy: ACTOR, createdAt: START }, { id: 'p2', depotId: D2, kind: 'SLHS', number: '8', validUntil: '2020-01-01', recordedBy: ACTOR, createdAt: START }],
      })),
    });
    const due = await service.due(new Date('2026-11-30T01:00:00Z'));
    expect(due.map((i) => `${i.depotName}:${i.name}`)).toEqual(['Cikini:SLHS 9']);
  });

  it('rejects an unknown depot on every read', async () => {
    const { service } = build({}, false);
    await expect(service.history(D1)).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.listLabTests(D1)).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.listPermits(D1)).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.end(D1, TEST, ACTOR)).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.addLabTest({ depotId: D1 } as never, { id: ACTOR, role: 'X' })).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.addPermit({ depotId: D1 } as never, ACTOR)).rejects.toBeInstanceOf(DepotNotFoundError);
  });
});

describe('QualityHoldController', () => {
  const user = { sub: ACTOR, role: 'HEAD_OFFICE', depotIds: [] } as never;
  const kepalaOther = { sub: ACTOR, role: 'KEPALA_DEPOT', depotIds: [D2] } as never;

  it('delegates every route and fences a Kepala to their own depot', async () => {
    const { service } = build();
    const c = new QualityHoldController(service);
    await c.start(D1, { reasonCode: 'COMPLAINT' }, user);
    await c.end(D1, { retestId: TEST }, user);
    await c.history(D1, user);
    await c.addLabTest(D1, { kind: 'ECOLI', takenOn: '2026-11-20', resultOn: '2026-11-20', result: 'PASS', labName: 'L', reportNo: '1' }, user);
    await c.labTests(D1, user);
    await c.addPermit(D1, { kind: 'SLHS', number: '1', validUntil: '2027-01-01' }, user);
    await c.permits(D1, user);
    expect(() => c.start(D1, { reasonCode: 'COMPLAINT' }, kepalaOther)).toThrow();
    expect(() => c.history(D1, kepalaOther)).toThrow();
  });

  it('serves the due list to crm-service', async () => {
    const { service } = build();
    expect(await new ComplianceInternalController(service).due()).toEqual({ items: [] });
  });
});

describe('PublicDepotView.from', () => {
  it('carries the hold flag and never a reason', () => {
    const base = { id: D1, code: 'C', name: 'N', address: 'a', city: 'c', province: 'p', lat: 0, lng: 0, serviceRadiusKm: 1, deliveryFee: 0, minOrderAmount: null, operatingHours: {}, holidays: [], active: true, paymentBankAccountNumber: null, paymentQrisImageUrl: null } as never;
    expect(PublicDepotView.from(base).qualityHold).toEqual({ active: false, since: null });
    const held = PublicDepotView.from({ ...(base as object), qualityHold: holdFlag(START) } as never);
    expect(held.qualityHold).toEqual({ active: true, since: START.toISOString() });
    expect(JSON.stringify(held)).not.toMatch(/LAB_FAIL|reason|note/i);
  });
});

describe('QualityHoldPrismaRepository', () => {
  function prismaFake() {
    const tx = {
      depotQualityHold: {
        create: jest.fn(async () => hold()),
        findFirst: jest.fn(async () => hold()),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: jest.fn(async () => hold({ status: 'ENDED' })),
        findMany: jest.fn(async () => [hold()]),
      },
      webhookEventOutbox: { create: jest.fn(async () => ({})) },
    };
    const prisma = {
      ...tx,
      depotLabTest: { create: jest.fn(async () => test()), findUnique: jest.fn(async () => test()), findMany: jest.fn(async () => [test()]) },
      depotPermit: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
      depot: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return { tx, prisma, repo: new QualityHoldPrismaRepository(prisma as unknown as PrismaService) };
  }

  it('writes the hold and its event in one transaction, without the note in the event', async () => {
    const { tx, repo, prisma } = prismaFake();
    const h = await repo.start({ depotId: D1, reasonCode: 'LAB_FAIL', note: 'rahasia', startedBy: ACTOR, at: START });
    expect(h?.id).toBe(HOLD);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const row = (tx.webhookEventOutbox.create.mock.calls[0] as unknown as [{ data: { payload: unknown } }])[0].data;
    expect(JSON.stringify(row)).not.toMatch(/rahasia/);
  });

  it('answers null when the partial unique index refuses a second ACTIVE hold, rethrows anything else', async () => {
    const a = prismaFake();
    a.tx.depotQualityHold.create.mockRejectedValueOnce({ code: 'P2002' });
    expect(await a.repo.start({ depotId: D1, reasonCode: 'OTHER', note: null, startedBy: ACTOR, at: START })).toBeNull();
    const b = prismaFake();
    b.tx.depotQualityHold.create.mockRejectedValueOnce(new Error('db down'));
    await expect(b.repo.start({ depotId: D1, reasonCode: 'OTHER', note: null, startedBy: ACTOR, at: START })).rejects.toThrow('db down');
  });

  it('ends the ACTIVE hold with its event; null when none or when a concurrent end won', async () => {
    const a = prismaFake();
    expect((await a.repo.end({ depotId: D1, endedBy: ACTOR, endRetestId: TEST, at: START }))?.status).toBe('ENDED');
    expect(a.tx.webhookEventOutbox.create).toHaveBeenCalledTimes(1);
    const b = prismaFake();
    b.tx.depotQualityHold.findFirst.mockResolvedValueOnce(null as never);
    expect(await b.repo.end({ depotId: D1, endedBy: ACTOR, endRetestId: TEST, at: START })).toBeNull();
    const c = prismaFake();
    c.tx.depotQualityHold.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await c.repo.end({ depotId: D1, endedBy: ACTOR, endRetestId: TEST, at: START })).toBeNull();
    expect(c.tx.webhookEventOutbox.create).not.toHaveBeenCalled();
  });

  it('reads and records tests, permits and the due source', async () => {
    const { repo } = prismaFake();
    expect((await repo.findActive(D1))?.id).toBe(HOLD);
    expect(await repo.history(D1)).toHaveLength(1);
    await repo.addLabTest({ depotId: D1, kind: 'ECOLI', takenOn: 'a', resultOn: 'b', result: 'PASS', labName: 'l', reportNo: 'r', recordedBy: ACTOR, recordedByRole: 'X' });
    expect((await repo.findLabTest(TEST))?.id).toBe(TEST);
    expect(await repo.listLabTests(D1)).toHaveLength(1);
    await repo.addPermit({ depotId: D1, kind: 'SLHS', number: '1', validUntil: '2027-01-01', recordedBy: ACTOR });
    expect(await repo.listPermits(D1)).toEqual([]);
    const src = await repo.complianceSource();
    expect(src.tests).toHaveLength(1);
    expect(src.depots).toEqual([]);
  });
});
