import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

import { loadCustomRoles, loadOverrides } from '@hydromart/access';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import { B2bProspectService } from '../../src/application/services/b2b-prospect.service';
import {
  ProspectInvalidError,
  ProspectNotFoundError,
  ProspectRefusedError,
  ProspectStaleError,
  ProspectTransitionError,
} from '../../src/domain/errors';
import { dncHash } from '../../src/domain/b2b-prospect-keys';
import { InMemoryProspectRepository, prospect } from '../support/b2b-fakes';
import { buildTestConfig } from '../support/fakes';

const SECRET = 'test-prospect-dnc-hmac-key-32-chars-long';
const as = (o: Record<string, unknown>) => ({ phone: null, ...o }) as unknown as AuthenticatedUser;
const kepalaA = as({ sub: 'kepala-a', role: Role.KEPALA_DEPOT, depotId: 'depot-a', depotIds: ['depot-a'] });
const kepalaB = as({ sub: 'kepala-b', role: Role.KEPALA_DEPOT, depotId: 'depot-b', depotIds: ['depot-b'] });
const sales = as({ sub: 'sales-1', role: 'C_sales', depotId: 'depot-a', depotIds: ['depot-a'] });
const marketing = as({ sub: 'm-1', role: Role.MARKETING, depotId: null });
const hq = as({ sub: 'hq-1', role: Role.HEAD_OFFICE, depotId: null });

describe('B2bProspectService', () => {
  let repo: InMemoryProspectRepository;
  let identity: { customerIdByPhone: jest.Mock };
  let listActive: jest.Mock;
  let roster: { staffIdsForDepot: jest.Mock };
  let svc: B2bProspectService;
  let fetchMock: jest.Mock;

  beforeAll(() => {
    loadCustomRoles([{ key: 'C_sales', name: 'Sales Depot', scope: 'LOCKED' }]);
    loadOverrides({ b2bProspectWork: ['C_sales'] });
  });
  afterAll(() => {
    loadOverrides({});
    loadCustomRoles([]);
  });

  beforeEach(() => {
    repo = new InMemoryProspectRepository();
    identity = { customerIdByPhone: jest.fn().mockResolvedValue(null) };
    listActive = jest.fn().mockResolvedValue([{ id: 'depot-a' }, { id: 'depot-b' }]);
    roster = { staffIdsForDepot: jest.fn().mockResolvedValue(['sales-1', 'kepala-a']) };
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    svc = new B2bProspectService(
      repo,
      identity as never,
      { listActive } as never,
      roster,
      buildTestConfig({ AUTH_SERVICE_URL: 'http://auth.test', INTERNAL_SERVICE_KEY: 'internal-key-01' }),
    );
  });

  const seed = (over: Parameters<typeof prospect>[0] = {}) => {
    const p = prospect(over);
    repo.rows.set(p.id, p);
    return p;
  };

  describe('list', () => {
    it('keeps a depot role inside its depots and never carries a phone, contact name or note', async () => {
      seed({ ownerDepotId: 'depot-a' });
      seed({ ownerDepotId: 'depot-b' });
      seed({ ownerDepotId: null });
      const res = await svc.list(kepalaA, {});
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({ ownerDepotId: 'depot-a', hasPhone: true });
      expect(JSON.stringify(res)).not.toMatch(/phoneE164|contactName|Bu Sari|\+6281200000001|catatan/);
    });

    it('lets a network role list every depot, narrow to one, and read the opportunity map', async () => {
      seed({ ownerDepotId: 'depot-a' });
      seed({ ownerDepotId: 'depot-b' });
      seed({ ownerDepotId: null });
      expect((await svc.list(marketing, {})).items).toHaveLength(2);
      expect((await svc.list(marketing, { depotId: 'depot-b' })).items).toHaveLength(1);
      const map = await svc.list(marketing, { scope: 'map' });
      expect(map.items).toHaveLength(1);
      expect(map.items[0]!.ownerDepotId).toBeNull();
    });

    it('refuses the opportunity map to a depot role', async () => {
      await expect(svc.list(kepalaA, { scope: 'map' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a depot the caller does not hold', async () => {
      await expect(svc.list(kepalaA, { depotId: 'depot-b' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('filters by assignment, status, category, area and name, and pages', async () => {
      const mine = seed({ assignedToId: 'kepala-a', name: 'Alpha Kos', status: 'CONTACTED', category: 'KOS', kecamatanCode: 'K1', kelurahanCode: 'L1' });
      const other = seed({ assignedToId: 'sales-1', name: 'Beta Klinik', category: 'KLINIK' });
      const free = seed({ assignedToId: null, name: 'Gamma' });
      const ids = async (q: object) => (await svc.list(kepalaA, q)).items.map((r) => r.id);
      expect(await ids({ assigned: 'me' })).toEqual([mine.id]);
      expect(await ids({ assigned: 'none' })).toEqual([free.id]);
      expect(await ids({ assigned: 'sales-1' })).toEqual([other.id]);
      expect(await ids({ status: 'CONTACTED', category: 'KOS', kecamatanCode: 'K1', kelurahanCode: 'L1' })).toEqual([mine.id]);
      expect(await ids({ q: ' klinik ' })).toEqual([other.id]);
      const page = await svc.list(kepalaA, { limit: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
      expect((await svc.list(kepalaA, { limit: 2, cursor: page.nextCursor! })).items).toHaveLength(1);
    });
  });

  describe('mine', () => {
    it('is the caller own assigned rows inside the reach, with the phone', async () => {
      const own = seed({ assignedToId: 'sales-1' });
      seed({ assignedToId: 'kepala-a' });
      seed({ assignedToId: 'sales-1', ownerDepotId: 'depot-b' });
      seed({ assignedToId: 'sales-1', ownerDepotId: null });
      const res = await svc.mine(sales, { q: 'kos', limit: 10 });
      expect(res.items.map((r) => r.id)).toEqual([own.id]);
      expect(res.items[0]!.phoneE164).toBe('+6281200000001');
      expect((await svc.mine(sales, {})).nextCursor).toBeNull();
    });

    it('never shows an opportunity-map row to a network role either', async () => {
      seed({ assignedToId: 'm-1', ownerDepotId: null });
      expect((await svc.mine(marketing, {})).items).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('opens a reachable row with its visits', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      repo.visitRows = [{ id: 'v1' } as never];
      const res = await svc.get(sales, p.id);
      expect(res).toMatchObject({ id: p.id, phoneE164: '+6281200000001', contactName: 'Bu Sari', visits: [{ id: 'v1' }] });
    });

    it.each([
      ['a row of another depot', kepalaB, { ownerDepotId: 'depot-a' }],
      ['a row assigned to somebody else (Sales)', sales, { assignedToId: 'sales-2' }],
      ['an unassigned row (Sales)', sales, {}],
      ['an opportunity-map row (depot role)', kepalaA, { ownerDepotId: null }],
      ['an opportunity-map row (network role)', marketing, { ownerDepotId: null }],
    ])('answers 404 for %s', async (_n, who, over) => {
      const p = seed(over);
      await expect(svc.get(who, p.id)).rejects.toBeInstanceOf(ProspectNotFoundError);
    });

    it('answers 404 for an id that does not exist', async () => {
      await expect(svc.get(kepalaA, 'nope')).rejects.toBeInstanceOf(ProspectNotFoundError);
    });
  });

  describe('setStatus', () => {
    const seen = (p: { updatedAt: Date }) => p.updatedAt.toISOString();

    it('moves a prospect along and counts it as activity', async () => {
      const p = seed({ lastActivityAt: new Date('2026-01-01T00:00:00Z') });
      const res = await svc.setStatus(kepalaA, p.id, { status: 'CONTACTED', seenUpdatedAt: seen(p) });
      expect(res.status).toBe('CONTACTED');
      expect(repo.rows.get(p.id)!.lastActivityAt.getFullYear()).toBeGreaterThanOrEqual(2026);
      expect(repo.rows.get(p.id)!.lastActivityAt.getTime()).toBeGreaterThan(new Date('2026-06-01').getTime());
    });

    it('answers 409 when the row changed since it was read', async () => {
      const p = seed();
      await expect(
        svc.setStatus(kepalaA, p.id, { status: 'CONTACTED', seenUpdatedAt: '2020-01-01T00:00:00.000Z' }),
      ).rejects.toBeInstanceOf(ProspectStaleError);
    });

    it.each(['CONVERTED', 'DO_NOT_CONTACT'] as const)('keeps %s for its own route', async (to) => {
      const p = seed({ status: 'INTERESTED' });
      await expect(svc.setStatus(kepalaA, p.id, { status: to, seenUpdatedAt: seen(p) })).rejects.toBeInstanceOf(ProspectTransitionError);
    });

    it('refuses the same state, a NEW to VISITED by hand, and any move out of a terminal state', async () => {
      const a = seed({ status: 'NEW' });
      await expect(svc.setStatus(kepalaA, a.id, { status: 'NEW', seenUpdatedAt: seen(a) })).rejects.toBeInstanceOf(ProspectTransitionError);
      await expect(svc.setStatus(kepalaA, a.id, { status: 'VISITED', seenUpdatedAt: seen(a) })).rejects.toBeInstanceOf(ProspectTransitionError);
      const t = seed({ status: 'CONVERTED' });
      await expect(svc.setStatus(kepalaA, t.id, { status: 'LOST', lostReason: 'abc', seenUpdatedAt: seen(t) })).rejects.toBeInstanceOf(ProspectTransitionError);
    });

    it('needs a lost reason of 3 to 200 characters, and keeps it only for LOST', async () => {
      const p = seed();
      for (const lostReason of [undefined, '  ', 'ab', 'x'.repeat(201)]) {
        await expect(svc.setStatus(kepalaA, p.id, { status: 'LOST', lostReason, seenUpdatedAt: seen(p) })).rejects.toBeInstanceOf(ProspectInvalidError);
      }
      const lost = await svc.setStatus(kepalaA, p.id, { status: 'LOST', lostReason: ' sudah punya langganan ', seenUpdatedAt: seen(p) });
      expect(lost).toMatchObject({ status: 'LOST', lostReason: 'sudah punya langganan' });
      const reopened = await svc.setStatus(kepalaA, p.id, { status: 'NEW', seenUpdatedAt: seen(repo.rows.get(p.id)!) });
      expect(reopened).toMatchObject({ status: 'NEW', lostReason: null });
    });

    it('lets only Manage reopen a LOST prospect', async () => {
      const p = seed({ status: 'LOST', assignedToId: 'sales-1' });
      await expect(svc.setStatus(sales, p.id, { status: 'NEW', seenUpdatedAt: seen(p) })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.setStatus(kepalaA, p.id, { status: 'NEW', seenUpdatedAt: seen(p) })).resolves.toMatchObject({ status: 'NEW' });
    });

    it('lets Sales work a prospect assigned to them but not another one', async () => {
      const mine = seed({ assignedToId: 'sales-1' });
      const theirs = seed({ assignedToId: 'sales-2' });
      await expect(svc.setStatus(sales, mine.id, { status: 'CONTACTED', seenUpdatedAt: seen(mine) })).resolves.toBeDefined();
      await expect(svc.setStatus(sales, theirs.id, { status: 'CONTACTED', seenUpdatedAt: seen(theirs) })).rejects.toBeInstanceOf(ProspectNotFoundError);
    });

    it('re-checks "already a customer" when a mobile prospect is first contacted, failing closed', async () => {
      const p = seed();
      identity.customerIdByPhone.mockResolvedValueOnce('cust-1');
      await expect(svc.setStatus(kepalaA, p.id, { status: 'CONTACTED', seenUpdatedAt: seen(p) })).rejects.toBeInstanceOf(ProspectRefusedError);
      expect(identity.customerIdByPhone).toHaveBeenCalledWith('+6281200000001');
      identity.customerIdByPhone.mockRejectedValueOnce(new ServiceUnavailableException('down'));
      await expect(svc.setStatus(kepalaA, p.id, { status: 'CONTACTED', seenUpdatedAt: seen(p) })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('does not ask auth about a landline, no phone, or a move that is not CONTACTED', async () => {
      const land = seed({ phoneE164: '+62215551234' });
      const none = seed({ phoneE164: null });
      const lost = seed();
      await svc.setStatus(kepalaA, land.id, { status: 'CONTACTED', seenUpdatedAt: seen(land) });
      await svc.setStatus(kepalaA, none.id, { status: 'CONTACTED', seenUpdatedAt: seen(none) });
      await svc.setStatus(kepalaA, lost.id, { status: 'LOST', lostReason: 'abc', seenUpdatedAt: seen(lost) });
      expect(identity.customerIdByPhone).not.toHaveBeenCalled();
    });
  });

  describe('assign', () => {
    it('assigns to a rostered staff member and unassigns', async () => {
      const p = seed();
      const a = await svc.assign(kepalaA, p.id, 'sales-1');
      expect(a).toMatchObject({ assignedToId: 'sales-1' });
      expect(a.assignedAt).toBeInstanceOf(Date);
      expect(roster.staffIdsForDepot).toHaveBeenCalledWith('depot-a');
      const b = await svc.assign(kepalaA, p.id, null);
      expect(b).toMatchObject({ assignedToId: null, assignedAt: null });
    });

    it('refuses an assignee who is not on the owner depot roster, and a roster that does not answer', async () => {
      const p = seed();
      await expect(svc.assign(kepalaA, p.id, 'stranger')).rejects.toBeInstanceOf(ProspectInvalidError);
      roster.staffIdsForDepot.mockRejectedValue(new ServiceUnavailableException('down'));
      await expect(svc.assign(kepalaA, p.id, 'sales-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('answers 422 for an opportunity-map row (never assignable) and 404 outside the depot', async () => {
      const onMap = seed({ ownerDepotId: null });
      await expect(svc.assign(marketing, onMap.id, 'sales-1')).rejects.toBeInstanceOf(ProspectInvalidError);
      await expect(svc.assign(kepalaA, onMap.id, 'sales-1')).rejects.toBeInstanceOf(ProspectNotFoundError);
      const other = seed({ ownerDepotId: 'depot-b' });
      await expect(svc.assign(kepalaA, other.id, 'sales-1')).rejects.toBeInstanceOf(ProspectNotFoundError);
    });

    it('refuses to assign a finished prospect', async () => {
      const p = seed({ status: 'DO_NOT_CONTACT' });
      await expect(svc.assign(kepalaA, p.id, 'sales-1')).rejects.toBeInstanceOf(ProspectTransitionError);
    });

    it('answers 404 if the row vanishes under the write', async () => {
      const p = seed();
      jest.spyOn(repo, 'update').mockResolvedValueOnce(null);
      await expect(svc.assign(kepalaA, p.id, null)).rejects.toBeInstanceOf(ProspectNotFoundError);
    });
  });

  describe('setOwnerDepot (HQ arbitration)', () => {
    it('moves the owner, marks it HQ, drops the old assignee and writes an audit entry', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      const res = await svc.setOwnerDepot(hq, p.id, { depotId: 'depot-b', reason: ' dekat gudang ' });
      expect(res).toMatchObject({ ownerDepotId: 'depot-b', ownerSource: 'HQ', assignedToId: null });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('http://auth.test/api/v1/auth/audit/internal');
      expect(JSON.parse(init.body)).toMatchObject({
        action: 'b2b.prospect.owner.set',
        actorId: 'hq-1',
        metadata: { before: 'depot-a', after: 'depot-b', reason: 'dekat gudang' },
      });
    });

    it('keeps the assignee when the owner does not change, and can send a row back to the map', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      expect(await svc.setOwnerDepot(hq, p.id, { depotId: 'depot-a', reason: 'tetap' })).toMatchObject({ assignedToId: 'sales-1', ownerSource: 'HQ' });
      expect(await svc.setOwnerDepot(hq, p.id, { depotId: null, reason: 'luar area' })).toMatchObject({ ownerDepotId: null, assignedToId: null });
    });

    it('refuses a depot that is not active, and fails when depot-service does not answer', async () => {
      const p = seed();
      await expect(svc.setOwnerDepot(hq, p.id, { depotId: 'depot-z', reason: 'abc' })).rejects.toBeInstanceOf(ProspectInvalidError);
      listActive.mockResolvedValue(null);
      await expect(svc.setOwnerDepot(hq, p.id, { depotId: 'depot-a', reason: 'abc' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('answers 404 for a missing row, and for one that vanishes under the write', async () => {
      await expect(svc.setOwnerDepot(hq, 'nope', { depotId: null, reason: 'abc' })).rejects.toBeInstanceOf(ProspectNotFoundError);
      const p = seed();
      jest.spyOn(repo, 'update').mockResolvedValueOnce(null);
      await expect(svc.setOwnerDepot(hq, p.id, { depotId: null, reason: 'abc' })).rejects.toBeInstanceOf(ProspectNotFoundError);
    });

    it('does not fail the change when the audit trail is down (fail-open, like the other audited changes)', async () => {
      fetchMock.mockRejectedValue(new Error('down'));
      const p = seed();
      await expect(svc.setOwnerDepot(hq, p.id, { depotId: 'depot-b', reason: 'abc' })).resolves.toBeDefined();
    });
  });

  describe('do-not-contact', () => {
    it('puts a phone on the list and wipes every live prospect with that number, keeping the pin and the name', async () => {
      const p = seed({ assignedToId: 'sales-1', note: 'n', address: 'a', contactName: 'c' });
      const keep = seed({ phoneE164: '+6281200000002', nameKey: 'lain' });
      const res = await svc.suppress(sales, { phone: '0812-0000-0001', reason: 'WRONG_NUMBER' });
      expect(res).toEqual({ entries: 1, prospects: 1 });
      expect(repo.rows.get(p.id)).toMatchObject({
        status: 'DO_NOT_CONTACT', phoneE164: null, contactName: null, note: null, address: null, assignedToId: null,
        name: '(dihapus: jangan hubungi)', nameKey: '', latitude: 0, longitude: 0, sourceId: null,
        // kept: what coverage needs and no unique index or hash depends on
        category: 'KOS', gridCell: '-689:11866', ownerDepotId: 'depot-a',
      });
      expect(repo.rows.get(keep.id)!.status).toBe('NEW');
      expect(repo.dnc.has(`PHONE:${dncHash(SECRET, 'PHONE', '+6281200000001')}`)).toBe(true);
    });

    it('puts a name at a pin on the list and catches a prospect in the next cell', async () => {
      const p = seed({ phoneE164: null, nameKey: 'kosmelati', gridCell: '-723:666' });
      const res = await svc.suppress(kepalaA, { name: 'Kos Melati', latitude: -6.5, longitude: 6.01, reason: 'LEGAL' });
      expect(res).toEqual({ entries: 1, prospects: 1 });
      expect(repo.rows.get(p.id)!.status).toBe('DO_NOT_CONTACT');
    });

    it('takes a phone and a place together, is idempotent, and leaves converted rows alone', async () => {
      const conv = seed({ status: 'CONVERTED', phoneE164: '+6281200000003' });
      const body = { phone: '0812-0000-0003', name: 'Kos Melati', latitude: -6.5, longitude: 6, reason: 'OTHER' as const };
      expect(await svc.suppress(kepalaA, body)).toEqual({ entries: 2, prospects: 0 });
      expect(await svc.suppress(kepalaA, body)).toEqual({ entries: 2, prospects: 0 });
      expect(repo.dnc.size).toBe(2);
      expect(repo.rows.get(conv.id)!.phoneE164).toBe('+6281200000003');
    });

    it.each([
      ['nothing to match', {}],
      ['a name without a pin', { name: 'Kos' }],
      ['a pin without a name', { latitude: -6.5, longitude: 6 }],
      ['a half pin', { name: 'Kos', latitude: -6.5 }],
      ['a name that normalises to nothing', { name: '!!!', latitude: -6.5, longitude: 6 }],
      ['a phone that is not a number', { phone: 'abc' }],
    ])('refuses %s', async (_n, body) => {
      await expect(svc.suppress(kepalaA, { ...body, reason: 'OTHER' })).rejects.toBeInstanceOf(ProspectInvalidError);
    });

    it('marks one prospect terminal with nothing that could reach the person kept', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      const twin = seed({ phoneE164: '+6281200000001', nameKey: 'lain' });
      const res = await svc.suppressProspect(kepalaA, p.id, 'PROSPECT_REFUSED');
      expect(res).toMatchObject({ status: 'DO_NOT_CONTACT', phoneE164: null, contactName: null, note: null, address: null, assignedToId: null });
      expect(repo.rows.get(twin.id)!.status).toBe('DO_NOT_CONTACT');
      expect(repo.dnc.size).toBe(2);
      await expect(svc.suppressProspect(kepalaA, p.id, 'OTHER')).rejects.toBeInstanceOf(ProspectTransitionError);
    });

    it('records only the place key for a prospect with no phone, and stays inside the reach', async () => {
      const p = seed({ phoneE164: null });
      await svc.suppressProspect(kepalaA, p.id, 'OTHER');
      expect(repo.dnc.size).toBe(1);
      await expect(svc.suppressProspect(kepalaB, seed().id, 'OTHER')).rejects.toBeInstanceOf(ProspectNotFoundError);
    });
  });

  describe('coverage', () => {
    const raw = {
      total: 3,
      onMap: 1,
      byCategory: [
        { category: 'KOS' as const, total: 3, withPhone: 1 },
        { category: 'KLINIK' as const, total: 0, withPhone: 0 },
      ],
      byStatus: [{ status: 'NEW' as const, total: 3 }],
      bySource: [{ source: 'OSM' as const, total: 3 }],
      age: { newest: Date.parse('2026-11-26T05:00:00Z'), median: Date.parse('2026-11-20T05:00:00Z'), oldest: Date.parse('2026-11-01T05:00:00Z') },
      thirdPartyCostIdr: 0,
    };

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-27T05:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('answers counts, percentages (0 for an empty group) and the data age in whole WIB days', async () => {
      const spy = jest.spyOn(repo, 'coverage').mockResolvedValue(raw);
      const res = await svc.coverage(marketing);
      expect(spy).toHaveBeenCalledWith({ depotIds: undefined, includeCost: true });
      expect(res.byCategory).toEqual([
        { category: 'KOS', total: 3, withPhone: 1, withPhonePct: 33.3 },
        { category: 'KLINIK', total: 0, withPhone: 0, withPhonePct: 0 },
      ]);
      expect(res).toMatchObject({ total: 3, onMap: 1, thirdPartyCostIdr: 0, dataAge: { newestDays: 1, medianDays: 7, oldestDays: 26 } });
    });

    it('scopes a depot role to its depots and withholds the cost; an empty table has no age', async () => {
      const spy = jest.spyOn(repo, 'coverage').mockResolvedValue({ ...raw, age: null, thirdPartyCostIdr: null });
      const res = await svc.coverage(kepalaA);
      expect(spy).toHaveBeenCalledWith({ depotIds: ['depot-a'], includeCost: false });
      expect(res).toMatchObject({ dataAge: null, thirdPartyCostIdr: null });
      await svc.coverage(marketing, 'depot-b');
      expect(spy).toHaveBeenLastCalledWith({ depotIds: ['depot-b'], includeCost: false });
      await expect(svc.coverage(kepalaA, 'depot-b')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('has no name, phone or address field anywhere on its response class', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { CoverageResponseDto, CoverageCategoryDto } = require('../../src/modules/dto/b2b-prospect.dto');
      const fields = [CoverageResponseDto, CoverageCategoryDto].flatMap((c) =>
        (Reflect.getMetadata('swagger/apiModelPropertiesArray', c.prototype) as string[]).map((k) => k.replace(/^:/, '')).filter((k) => !k.startsWith('withPhone')),
      );
      expect(fields.length).toBeGreaterThan(8);
      expect(fields.join(',')).not.toMatch(/name|phone|address|contact|note/i);
    });
  });

  describe('global do-not-contact, reach and audit (review fixes)', () => {
    const auditBodies = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/audit/internal')).map(([, i]) => JSON.parse(i.body));

    it('wipes matches in EVERY depot but counts only the ones inside the caller reach', async () => {
      const mine = seed({ ownerDepotId: 'depot-a' });
      const theirs = seed({ ownerDepotId: 'depot-b' });
      const onMap = seed({ ownerDepotId: null });
      const res = await svc.suppress(kepalaA, { phone: '0812-0000-0001', reason: 'LEGAL' });
      expect(res.prospects).toBe(1);
      for (const p of [mine, theirs, onMap]) expect(repo.rows.get(p.id)!.status).toBe('DO_NOT_CONTACT');
      // a network role sees the whole count
      const a = seed({ ownerDepotId: 'depot-a' });
      const b = seed({ ownerDepotId: 'depot-b', phoneE164: '+6281200000009' });
      expect((await svc.suppress(marketing, { phone: '0812-0000-0009', reason: 'LEGAL' })).prospects).toBe(1);
      expect(a.status).toBe('NEW');
      expect(repo.rows.get(b.id)!.status).toBe('DO_NOT_CONTACT');
    });

    it('does not move the retention clock for assign, an owner change or do-not-contact, but does for a status change', async () => {
      const old = new Date('2026-01-01T00:00:00Z');
      const p = seed({ lastActivityAt: old });
      await svc.assign(kepalaA, p.id, 'sales-1');
      expect(repo.rows.get(p.id)!.lastActivityAt).toEqual(old);
      await svc.setOwnerDepot(hq, p.id, { depotId: 'depot-b', reason: 'abc' });
      expect(repo.rows.get(p.id)!.lastActivityAt).toEqual(old);
      const q = seed({ lastActivityAt: old, ownerDepotId: 'depot-b' });
      await svc.suppressProspect(kepalaB, q.id, 'OTHER');
      expect(repo.rows.get(q.id)!.lastActivityAt).toEqual(old);
      const r = seed({ lastActivityAt: old });
      await svc.setStatus(kepalaA, r.id, { status: 'CONTACTED', seenUpdatedAt: r.updatedAt.toISOString() });
      expect(repo.rows.get(r.id)!.lastActivityAt.getTime()).toBeGreaterThan(old.getTime());
    });

    it('audits status, assign, suppress and suppressProspect with ids, codes and counts only', async () => {
      const p = seed({ name: 'Kos Rahasia', address: 'Jl. Rahasia', phoneE164: '+6281255555555' });
      await svc.setStatus(kepalaA, p.id, { status: 'CONTACTED', seenUpdatedAt: p.updatedAt.toISOString() });
      await svc.assign(kepalaA, p.id, 'sales-1');
      await svc.suppress(kepalaA, { phone: '0812-9999-9999', name: 'Kos Rahasia', latitude: -6.2, longitude: 106.8, reason: 'LEGAL' });
      const q = seed({ phoneE164: '+6281266666666' });
      await svc.suppressProspect(kepalaA, q.id, 'OTHER');
      const bodies = auditBodies();
      expect(bodies.map((b) => b.action)).toEqual([
        'b2b.prospect.status', 'b2b.prospect.assign', 'b2b.prospect.suppress', 'b2b.prospect.suppress.prospect',
      ]);
      expect(bodies[0].metadata).toEqual({ prospectId: p.id, from: 'NEW', to: 'CONTACTED' });
      expect(bodies[2].metadata).toMatchObject({ reason: 'LEGAL', entries: 2, byPhone: true, byPlace: true });
      const text = JSON.stringify(bodies);
      expect(text).not.toMatch(/Rahasia|\+62|-6\.2|106\.8/);
      expect(bodies.every((b) => b.actorId === 'kepala-a')).toBe(true);
    });

    it('list rows for a Read-only caller carry hasPhone and never a phone, contact name or note', async () => {
      seed();
      const row = (await svc.list(marketing, {})).items[0]!;
      expect(row.hasPhone).toBe(true);
      for (const k of ['phoneE164', 'contactName', 'note', 'nameKey', 'licence', 'customerId']) expect(row).not.toHaveProperty(k);
    });
  });
});
