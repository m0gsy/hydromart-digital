import { BadRequestException, ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common';

import { loadCustomRoles, loadOverrides } from '@hydromart/access';
import { AuthenticatedUser, Role, haversineMeters } from '@hydromart/platform';

import { B2bProspectExportService, EXPORT_MAX, EXPORT_VISITS_MAX } from '../../src/application/services/b2b-prospect-export.service';
import { B2bProspectMaintenanceService } from '../../src/application/services/b2b-prospect-maintenance.service';
import { B2bProspectVisitService, REFUSAL_APPROXIMATE } from '../../src/application/services/b2b-prospect-visit.service';
import { B2bProspectService } from '../../src/application/services/b2b-prospect.service';
import {
  ProspectInvalidError,
  ProspectNotFoundError,
  ProspectStaleError,
  ProspectTransitionError,
} from '../../src/domain/errors';
import { InMemoryProspectRepository, prospect } from '../support/b2b-fakes';
import { buildTestConfig } from '../support/fakes';

const as = (o: Record<string, unknown>) => ({ phone: null, ...o }) as unknown as AuthenticatedUser;
const kepalaA = as({ sub: 'kepala-a', role: Role.KEPALA_DEPOT, depotId: 'depot-a', depotIds: ['depot-a'] });
const sales = as({ sub: 'sales-1', role: 'C_sales', depotId: 'depot-a', depotIds: ['depot-a'] });
const marketing = as({ sub: 'm-1', role: Role.MARKETING, depotId: null });
/** A role that may export but not manage: only ever sees what is assigned to it. */
const exporterOnly = as({ sub: 'x-1', role: 'C_exporter', depotId: 'depot-a', depotIds: ['depot-a'] });

// A pin on the 200 m radius test: ~0.001 deg of latitude is ~111 m.
const PIN = { latitude: -6.2013, longitude: 106.8137 };
const good = { ...PIN, accuracyM: 12, outcome: 'MET_DECISION_MAKER' as const };

describe('B2B prospects, work it / export it / expire it (AREA-1b)', () => {
  let repo: InMemoryProspectRepository;
  let identity: { customerIdByPhone: jest.Mock; getAccountOwners: jest.Mock };
  let importer: { resolveByPhone: jest.Mock };
  let fetchMock: jest.Mock;

  const config = (extra: Record<string, string> = {}) =>
    buildTestConfig({ AUTH_SERVICE_URL: 'http://auth.test', INTERNAL_SERVICE_KEY: 'internal-key-01', ...extra });
  const seed = (over: Parameters<typeof prospect>[0] = {}) => {
    const p = prospect({ latitude: PIN.latitude, longitude: PIN.longitude, ...over });
    repo.rows.set(p.id, p);
    return p;
  };
  const auditBodies = () =>
    fetchMock.mock.calls.filter(([u]) => String(u).includes('/audit/internal')).map(([, i]) => JSON.parse(i.body));
  const makeProspects = (cfg = config()) =>
    new B2bProspectService(
      repo,
      identity as never,
      { listActive: jest.fn() } as never,
      { staffIdsForDepot: jest.fn() },
      cfg,
      importer as never,
    );

  beforeAll(() => {
    loadCustomRoles([
      { key: 'C_sales', name: 'Sales Depot', scope: 'LOCKED' },
      { key: 'C_exporter', name: 'Exporter', scope: 'LOCKED' },
    ]);
    loadOverrides({ b2bProspectWork: ['C_sales'], b2bProspectExport: ['C_exporter'] });
  });
  afterAll(() => {
    loadOverrides({});
    loadCustomRoles([]);
  });

  beforeEach(() => {
    repo = new InMemoryProspectRepository();
    identity = { customerIdByPhone: jest.fn().mockResolvedValue(null), getAccountOwners: jest.fn() };
    importer = { resolveByPhone: jest.fn().mockResolvedValue({ customerId: 'new-cust', status: 'created' }) };
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => jest.restoreAllMocks());

  describe('visit check-in', () => {
    const visitSvc = (cfg = config()) => new B2bProspectVisitService(repo, makeProspects(cfg), cfg);

    it('records an accurate check-in at the pin, moves NEW to VISITED and the retention clock, audits ids only', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      const res = await visitSvc().visit(sales, p.id, { ...good, note: ' ketemu bu Sari ' });
      expect(res.prospect.status).toBe('VISITED');
      expect(res.visit).toMatchObject({ visitorId: 'sales-1', distanceM: 0, outcome: 'MET_DECISION_MAKER', note: 'ketemu bu Sari' });
      expect(repo.rows.get(p.id)!.lastActivityAt.getTime()).toBeGreaterThan(p.lastActivityAt.getTime());
      const [audit] = auditBodies();
      expect(audit).toMatchObject({ action: 'b2b.prospect.visit', actorId: 'sales-1' });
      expect(audit.metadata).toEqual({ prospectId: p.id, outcome: 'MET_DECISION_MAKER', distanceM: 0, from: 'NEW', to: 'VISITED' });
      expect(JSON.stringify(audit)).not.toMatch(/-6\.20|106\.81|ketemu/);
    });

    it('moves CONTACTED to VISITED but leaves VISITED and INTERESTED where they are', async () => {
      for (const [from, to] of [['CONTACTED', 'VISITED'], ['VISITED', 'VISITED'], ['INTERESTED', 'INTERESTED']] as const) {
        const p = seed({ status: from, assignedToId: 'sales-1' });
        expect((await visitSvc().visit(sales, p.id, good)).prospect.status).toBe(to);
      }
    });

    it('is accepted exactly at the radius and refused a hair beyond it', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      const fix = { latitude: PIN.latitude + 0.0018, longitude: PIN.longitude };
      const d = haversineMeters(PIN.latitude, PIN.longitude, fix.latitude, fix.longitude);
      const svc = (r: number) => visitSvc(config({ PROSPECT_VISIT_RADIUS_M: String(r) }));
      await expect(svc(d).visit(sales, p.id, { ...good, ...fix, accuracyM: 5 })).resolves.toBeDefined();
      await expect(svc(d - 0.001).visit(sales, p.id, { ...good, ...fix, accuracyM: 5 })).rejects.toThrow(/Di luar area usaha/);
    });

    it('refuses with 422 and the distance when outside the default 200 m', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      await expect(visitSvc().visit(sales, p.id, { ...good, latitude: PIN.latitude + 0.003 })).rejects.toThrow(ProspectInvalidError);
      expect(repo.visitRows).toHaveLength(0);
      expect(repo.rows.get(p.id)!.status).toBe('NEW');
    });

    it.each([
      ['NaN', NaN],
      ['negative', -1],
      ['infinite', Infinity],
    ])('refuses a %s accuracy', async (_n, accuracyM) => {
      const p = seed({ assignedToId: 'sales-1' });
      await expect(visitSvc().visit(sales, p.id, { ...good, accuracyM })).rejects.toThrow(/Akurasi lokasi/);
    });

    it('refuses an accuracy of 1000 m or worse, an accuracy wider than the radius, and a coarse-grid point, with the Tepat text', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      for (const accuracyM of [1000, 250]) {
        await expect(visitSvc().visit(sales, p.id, { ...good, accuracyM })).rejects.toThrow(REFUSAL_APPROXIMATE);
      }
      // 2 km coarse grid: a multiple of the grid step on both axes (what Android "Perkiraan" returns).
      const step = 2000 / 111_000;
      const lat = Math.round(-6.2 / step) * step;
      const lng = Math.round(106.8 / (step / Math.cos((lat * Math.PI) / 180))) * (step / Math.cos((lat * Math.PI) / 180));
      const q = seed({ latitude: lat, longitude: lng, assignedToId: 'sales-1' });
      await expect(visitSvc().visit(sales, q.id, { latitude: lat, longitude: lng, accuracyM: 10, outcome: 'NOT_THERE' })).rejects.toThrow(REFUSAL_APPROXIMATE);
    });

    it('refuses a pin that is not a number instead of letting a NaN distance pass', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      await expect(visitSvc().visit(sales, p.id, { ...good, latitude: NaN })).rejects.toThrow(ProspectInvalidError);
    });

    it('never writes a coordinate or a phone into a log line on refusal', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await visitSvc().visit(sales, p.id, { ...good, latitude: PIN.latitude + 0.01 }).catch(() => undefined);
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toMatch(/visitor sales-1, prospect .*, \d+ m, radius 200 m, accuracy 12 m/);
      expect(line).not.toMatch(/-6\.2|106\.8|\+62/);
    });

    it('refuses a finished prospect (409), a stranger (404) and a row moved meanwhile (409)', async () => {
      const done = seed({ status: 'LOST', assignedToId: 'sales-1' });
      await expect(visitSvc().visit(sales, done.id, good)).rejects.toThrow(ProspectTransitionError);
      const other = seed({ assignedToId: 'somebody-else' });
      await expect(visitSvc().visit(sales, other.id, good)).rejects.toThrow(ProspectNotFoundError);
      const p = seed({ assignedToId: 'sales-1' });
      jest.spyOn(repo, 'recordVisit').mockResolvedValue(null);
      await expect(visitSvc().visit(sales, p.id, good)).rejects.toThrow(ProspectStaleError);
    });

    it('a visit with no note stores none', async () => {
      const p = seed({ assignedToId: 'sales-1' });
      expect((await visitSvc().visit(sales, p.id, good)).visit.note).toBeNull();
    });
  });

  describe('convert', () => {
    const svc = () => makeProspects();

    it('verifies a named customer account and links it; wrong status is 409', async () => {
      const p = seed({ status: 'INTERESTED', assignedToId: 'sales-1', phoneE164: null });
      identity.getAccountOwners.mockResolvedValue(new Map([['cust-1', { fullName: 'A', phone: null }]]));
      const res = await svc().convert(sales, p.id, 'cust-1');
      expect(res).toMatchObject({ status: 'CONVERTED', customerId: 'cust-1' });
      expect(res.convertedAt).toBeInstanceOf(Date);
      expect(importer.resolveByPhone).not.toHaveBeenCalled();
      expect(auditBodies()[0]).toMatchObject({ action: 'b2b.prospect.converted', metadata: { prospectId: p.id, customerId: 'cust-1' } });
      const fresh = seed({ status: 'NEW', assignedToId: 'sales-1' });
      await expect(svc().convert(sales, fresh.id)).rejects.toThrow(ProspectTransitionError);
    });

    it('422 when the named account does not exist (auth answers without it)', async () => {
      const p = seed({ status: 'VISITED', assignedToId: 'sales-1' });
      identity.getAccountOwners.mockResolvedValue(new Map());
      await expect(svc().convert(sales, p.id, 'ghost')).rejects.toThrow(ProspectInvalidError);
      expect(repo.rows.get(p.id)!.status).toBe('VISITED');
    });

    describe('a named account must hold the prospect mobile number', () => {
      const account = (phone: string | null) => identity.getAccountOwners.mockResolvedValue(new Map([['cust-1', { fullName: 'A', phone }]]));

      it('links when the numbers match after normalising (08.. vs +628..)', async () => {
        const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000001' });
        account('081200000001');
        expect((await svc().convert(sales, p.id, 'cust-1')).customerId).toBe('cust-1');
      });

      it('422 on a different number, and nothing is converted', async () => {
        const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000001' });
        account('+6281299999999');
        await expect(svc().convert(sales, p.id, 'cust-1')).rejects.toThrow(ProspectInvalidError);
        expect(repo.rows.get(p.id)!.status).toBe('VISITED');
      });

      it('422 when auth answers the account without a phone: a match cannot be proven (fail closed)', async () => {
        const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000001' });
        account(null);
        await expect(svc().convert(sales, p.id, 'cust-1')).rejects.toThrow(ProspectInvalidError);
      });

      it('a landline prospect keeps the existence check only', async () => {
        const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+62215550123' });
        account('+6281299999999');
        expect((await svc().convert(sales, p.id, 'cust-1')).customerId).toBe('cust-1');
      });
    });

    it('uses the account behind the mobile number when there is one', async () => {
      const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000001' });
      identity.customerIdByPhone.mockResolvedValue('cust-by-phone');
      expect((await svc().convert(sales, p.id)).customerId).toBe('cust-by-phone');
      expect(importer.resolveByPhone).not.toHaveBeenCalled();
    });

    it('pre-registers a PENDING account at the owner depot when none exists', async () => {
      const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000001', contactName: null, name: 'Kos Melati' });
      expect((await svc().convert(sales, p.id)).customerId).toBe('new-cust');
      expect(importer.resolveByPhone).toHaveBeenCalledWith('+6281200000001', 'Kos Melati', 'depot-a');
    });

    it('names the PENDING account after the contact person when there is one', async () => {
      const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000004', contactName: 'Bu Sari' });
      await svc().convert(sales, p.id);
      expect(importer.resolveByPhone).toHaveBeenCalledWith('+6281200000004', 'Bu Sari', 'depot-a');
    });

    it('422 for a landline or no phone without a customerId', async () => {
      for (const phoneE164 of ['+62215550123', null]) {
        const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164 });
        await expect(svc().convert(sales, p.id)).rejects.toThrow(ProspectInvalidError);
      }
    });

    it('is idempotent: converting a converted prospect returns it untouched', async () => {
      const p = seed({ status: 'CONVERTED', customerId: 'cust-1', assignedToId: 'sales-1' });
      expect((await svc().convert(sales, p.id)).customerId).toBe('cust-1');
      expect(identity.getAccountOwners).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('two converts at once: the loser gets the winner, a different change is stale', async () => {
      const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000001' });
      jest.spyOn(repo, 'update').mockImplementationOnce(async (id) => {
        repo.rows.set(id, { ...repo.rows.get(id)!, status: 'CONVERTED', customerId: 'winner' });
        return null;
      });
      expect((await svc().convert(sales, p.id)).customerId).toBe('winner');
      const q = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000003' });
      jest.spyOn(repo, 'update').mockResolvedValueOnce(null);
      await expect(svc().convert(sales, q.id)).rejects.toThrow(ProspectStaleError);
    });

    it('fails hard when auth does not answer: nothing is converted', async () => {
      const p = seed({ status: 'VISITED', assignedToId: 'sales-1', phoneE164: '+6281200000001' });
      identity.customerIdByPhone.mockRejectedValue(new ServiceUnavailableException());
      await expect(svc().convert(sales, p.id)).rejects.toThrow(ServiceUnavailableException);
      expect(repo.rows.get(p.id)!.status).toBe('VISITED');
    });
  });

  describe('export', () => {
    const exportSvc = (cfg = config(), regions?: { nameOf: (c: string) => string | null }) =>
      new B2bProspectExportService(repo, cfg, regions as never);

    it('locks a depot role to its own depot and names the source and licence on every row', async () => {
      seed({ ownerDepotId: 'depot-a', source: 'OVERTURE', licence: 'CDLA-Permissive-2.0', sourceId: 'ov-1', sourceDate: new Date('2026-10-01T00:00:00Z') });
      seed({ ownerDepotId: 'depot-b' });
      seed({ ownerDepotId: null });
      const res = await exportSvc().export(kepalaA, {});
      expect(res.rowCount).toBe(1);
      expect(res.rows[0]).toMatchObject({ source: 'OVERTURE', licence: 'CDLA-Permissive-2.0', sourceId: 'ov-1', sourceDate: '2026-10-01T00:00:00.000Z', phone: '+6281200000001' });
      await expect(exportSvc().export(kepalaA, { depotId: 'depot-b' })).rejects.toThrow(ForbiddenException);
    });

    it('lets a network role export every depot, one depot, and the map rows', async () => {
      seed({ ownerDepotId: 'depot-a' });
      seed({ ownerDepotId: 'depot-b' });
      seed({ ownerDepotId: null });
      expect((await exportSvc().export(marketing, {})).rowCount).toBe(3);
      expect((await exportSvc().export(marketing, { depotId: 'depot-b' })).rowCount).toBe(1);
    });

    it('never exports a do-not-contact row or an anonymised one', async () => {
      seed({ status: 'DO_NOT_CONTACT', nameKey: '' });
      seed({ status: 'CONVERTED', nameKey: '' });
      seed();
      expect((await exportSvc().export(kepalaA, {})).rowCount).toBe(1);
    });

    it('writes the audit entry BEFORE returning rows, with ids, counts and codes only (no phone)', async () => {
      seed({ phoneE164: '+6281277777777', name: 'Kos Rahasia', kecamatanCode: '3173010' });
      const order: string[] = [];
      fetchMock.mockImplementation(async () => {
        order.push('audit');
        return { ok: true };
      });
      const res = await exportSvc().export(kepalaA, { status: 'NEW', category: 'KOS', kecamatanCode: '3173010', assigned: 'none' });
      order.push('rows');
      expect(order).toEqual(['audit', 'rows']);
      const [audit] = auditBodies();
      expect(audit).toMatchObject({ action: 'b2b.prospect.export', actorId: 'kepala-a', target: 'b2b-prospects:depot-a' });
      expect(audit.metadata).toEqual({ rowCount: 1, visitCount: 0, truncated: false, sources: { OSM: 1 }, status: 'NEW', category: 'KOS', kecamatanCode: '3173010', assigned: 'none' });
      expect(JSON.stringify(audit)).not.toMatch(/\+62|Rahasia/);
      expect(res.rowCount).toBe(1);
    });

    it('audit entry labels for me / staff / none given, and the network target', async () => {
      seed();
      await exportSvc().export(marketing, { assigned: 'me' });
      await exportSvc().export(marketing, { assigned: '11111111-1111-4111-8111-111111111111' });
      await exportSvc().export(marketing, {});
      const metas = auditBodies().map((b) => [b.target, b.metadata.assigned]);
      expect(metas).toEqual([['b2b-prospects:network', 'me'], ['b2b-prospects:network', 'staff'], ['b2b-prospects:network', null]]);
    });

    it('FAIL-CLOSED: an audit that throws returns 503 and no rows', async () => {
      seed();
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      await expect(exportSvc().export(kepalaA, {})).rejects.toThrow(ServiceUnavailableException);
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
      await expect(exportSvc().export(kepalaA, {})).rejects.toThrow(/Ekspor dibatalkan/);
    });

    it('FAIL-CLOSED: an unconfigured audit trail refuses the export, with no call at all', async () => {
      seed();
      fetchMock.mockClear();
      await expect(exportSvc(buildTestConfig({})).export(kepalaA, {})).rejects.toThrow(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('caps at 5000 rows and says truncated; the audit counts what was returned', async () => {
      for (let i = 0; i < EXPORT_MAX + 1; i++) seed({ phoneE164: null, sourceId: String(i) });
      const res = await exportSvc().export(kepalaA, {});
      expect(res.truncated).toBe(true);
      expect(res.rows).toHaveLength(EXPORT_MAX);
      expect(auditBodies()[0].metadata).toMatchObject({ rowCount: EXPORT_MAX, truncated: true });
    });

    it('returns the visits of the exported rows by row index, with no pin, note or prospect id, and counts them in the audit', async () => {
      const a = seed({ ownerDepotId: 'depot-a' });
      const other = seed({ ownerDepotId: 'depot-b' });
      const at = new Date('2026-11-20T03:00:00Z');
      repo.exportVisitRows.push(
        { prospectId: a.id, visitorId: 'v-1', visitedAt: at, outcome: 'NOT_THERE', distanceM: 40 },
        { prospectId: other.id, visitorId: 'v-2', visitedAt: at, outcome: 'REFUSED', distanceM: 10 },
      );
      const res = await exportSvc().export(kepalaA, {});
      expect(res.visits).toEqual([{ rowIndex: 0, visitorId: 'v-1', visitedAt: '2026-11-20T03:00:00.000Z', outcome: 'NOT_THERE', distanceM: 40 }]);
      expect(JSON.stringify(res.visits)).not.toMatch(/latitude|longitude|note|prospectId/);
      expect(auditBodies()[0].metadata.visitCount).toBe(1);
    });

    it('asks the repository for at most EXPORT_VISITS_MAX visits', async () => {
      seed();
      const spy = jest.spyOn(repo, 'exportVisits');
      await exportSvc().export(kepalaA, {});
      expect(spy).toHaveBeenCalledWith([expect.any(String)], EXPORT_VISITS_MAX);
    });

    it('FAIL-CLOSED: when the audit entry fails, no visits leave either', async () => {
      const a = seed();
      repo.exportVisitRows.push({ prospectId: a.id, visitorId: 'v', visitedAt: new Date(), outcome: 'NOT_THERE', distanceM: 1 });
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      await expect(exportSvc().export(kepalaA, {})).rejects.toThrow(ServiceUnavailableException);
    });

    it('neutralises a cell that starts with = + - @ tab or CR, except the phone', async () => {
      for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
        seed({ name: `${lead}cmd`, contactName: `${lead}x`, address: `${lead}y`, licence: `${lead}l`, sourceId: `${lead}s`, phoneE164: '+6281200000009' });
      }
      const res = await exportSvc().export(kepalaA, {});
      for (const r of res.rows) {
        for (const k of ['name', 'contactName', 'address', 'licence', 'sourceId'] as const) expect(r[k]).toMatch(/^'[=+\-@\t\r]/);
        expect(r.phone).toBe('+6281200000009');
        expect(typeof r.latitude).toBe('number');
      }
    });

    it('leaves an ordinary cell alone and resolves region names when the asset knows them', async () => {
      seed({ name: 'Kos Melati', kecamatanCode: '31.73', kelurahanCode: null });
      const [row] = (await exportSvc(config(), { nameOf: (c) => (c === '31.73' ? '=Gambir' : null) }).export(kepalaA, {})).rows;
      expect(row).toMatchObject({ name: 'Kos Melati', kecamatan: "'=Gambir", kelurahan: null, sourceDate: null });
    });

    it('a role that may export but not manage sees only what is assigned to it', async () => {
      seed({ assignedToId: 'x-1' });
      seed({ assignedToId: null });
      seed({ assignedToId: 'other' });
      expect((await exportSvc().export(exporterOnly, {})).rowCount).toBe(1);
      expect((await exportSvc().export(exporterOnly, { assigned: 'none' })).rowCount).toBe(1);
    });

    it('filters by unassigned and by a named assignee for a manager', async () => {
      seed({ assignedToId: 'sales-1' });
      seed({ assignedToId: null });
      expect((await exportSvc().export(kepalaA, { assigned: 'none' })).rowCount).toBe(1);
      expect((await exportSvc().export(kepalaA, { assigned: 'sales-1' })).rowCount).toBe(1);
    });
  });

  describe('purge (retention)', () => {
    const maint = () => new B2bProspectMaintenanceService(repo, { listActive: jest.fn() } as never, config());
    const cutoff = new Date('2026-06-01T00:00:00.000Z');
    const at = (iso: string) => new Date(iso);
    const NOW = new Date('2027-06-02T00:00:00.000Z');
    beforeEach(() => jest.useFakeTimers({ now: NOW }));
    afterEach(() => jest.useRealTimers());

    it('refuses a cutoff newer than 360 days ago, accepts one at or past it, refuses a non-date', async () => {
      const day = 86_400_000;
      const m = maint();
      await expect(m.purge(new Date(NOW.getTime() - 359 * day))).rejects.toThrow(BadRequestException);
      await expect(m.purge(new Date(NOW.getTime() - 359 * day))).rejects.toThrow(/360 hari/);
      await expect(m.purge(new Date(NOW.getTime() - 360 * day + 1))).rejects.toThrow(BadRequestException);
      await expect(m.purge(new Date('nope'))).rejects.toThrow(BadRequestException);
      expect(await m.purge(new Date(NOW.getTime() - 360 * day))).toEqual({ deleted: 0, anonymised: 0 });
      expect(await m.purge(new Date(NOW.getTime() - 361 * day))).toEqual({ deleted: 0, anonymised: 0 });
    });

    it('deletes an unconverted row idle for longer than the cutoff, keeps one exactly AT it', async () => {
      const old = seed({ lastActivityAt: at('2026-05-31T23:59:59.999Z') });
      const edge = seed({ lastActivityAt: cutoff });
      const fresh = seed({ lastActivityAt: at('2026-10-01T00:00:00Z') });
      expect(await maint().purge(cutoff)).toEqual({ deleted: 1, anonymised: 0 });
      expect(repo.rows.has(old.id)).toBe(false);
      expect(repo.rows.has(edge.id)).toBe(true);
      expect(repo.rows.has(fresh.id)).toBe(true);
    });

    it('anonymises an idle converted row: it keeps category, area, source, owner depot, status and the date', async () => {
      const c = seed({
        status: 'CONVERTED', customerId: 'cust-9', convertedAt: at('2025-12-05T03:00:00Z'), lastActivityAt: at('2025-12-05T03:00:00Z'),
        kecamatanCode: '3173010', kelurahanCode: '3173010001', gridCell: '-690:11866', source: 'OVERTURE', sourceId: 'ov-1', licence: 'ODbL-1.0',
      });
      expect(await maint().purge(cutoff)).toEqual({ deleted: 0, anonymised: 1 });
      const row = repo.rows.get(c.id)!;
      expect(row).toMatchObject({
        status: 'CONVERTED', category: 'KOS', kecamatanCode: '3173010', kelurahanCode: '3173010001', gridCell: '-690:11866',
        source: 'OVERTURE', ownerDepotId: 'depot-a', nameKey: '', latitude: 0, longitude: 0, phoneE164: null, contactName: null,
        address: null, note: null, sourceId: null, customerId: null,
      });
      expect(row.convertedAt).toEqual(at('2025-12-05T03:00:00Z'));
      expect(row.name).not.toContain('Melati');
      // a second sweep finds nothing left to do
      expect(await maint().purge(cutoff)).toEqual({ deleted: 0, anonymised: 0 });
    });

    it('leaves a converted row with recent activity alone', async () => {
      const c = seed({ status: 'CONVERTED', lastActivityAt: at('2026-10-01T00:00:00Z') });
      expect(await maint().purge(cutoff)).toEqual({ deleted: 0, anonymised: 0 });
      expect(repo.rows.get(c.id)!.name).toBe('Kos Melati');
    });

    it('a do-not-contact row runs on its OWN clock: deleted 12 months after the wipe, not after the last activity', async () => {
      const stale = seed({ status: 'DO_NOT_CONTACT', nameKey: '', lastActivityAt: at('2025-01-01T00:00:00Z'), suppressedAt: at('2026-05-01T00:00:00Z') });
      const wiped = seed({ status: 'DO_NOT_CONTACT', nameKey: '', lastActivityAt: at('2025-01-01T00:00:00Z'), suppressedAt: at('2026-03-01T00:00:00Z') });
      const legacy = seed({ status: 'DO_NOT_CONTACT', nameKey: '', lastActivityAt: at('2025-01-01T00:00:00Z'), suppressedAt: null });
      expect(await maint().purge(at('2026-04-01T00:00:00Z'))).toEqual({ deleted: 2, anonymised: 0 });
      expect(repo.rows.has(stale.id)).toBe(true);
      expect(repo.rows.has(wiped.id)).toBe(false);
      expect(repo.rows.has(legacy.id)).toBe(false);
    });

    it('never touches the do-not-contact list', async () => {
      repo.dnc.add('PHONE:abc');
      seed({ lastActivityAt: at('2025-01-01T00:00:00Z') });
      await maint().purge(cutoff);
      expect(repo.dnc.has('PHONE:abc')).toBe(true);
    });

    it('logs counts only', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      seed({ lastActivityAt: at('2025-01-01T00:00:00Z'), name: 'Kos Rahasia' });
      await maint().purge(cutoff);
      expect(String(log.mock.calls[0]![0])).toBe('B2B prospect retention: 1 deleted, 0 anonymised');
    });

    it('a re-offered row (import) does not bump lastActivityAt, a visit does', async () => {
      const p = seed({ lastActivityAt: at('2025-01-01T00:00:00Z'), assignedToId: 'sales-1' });
      // a refused / duplicate re-import never reaches repo.update or recordVisit: nothing moves
      expect(repo.rows.get(p.id)!.lastActivityAt).toEqual(at('2025-01-01T00:00:00Z'));
      const cfg = config();
      await new B2bProspectVisitService(repo, makeProspects(cfg), cfg).visit(sales, p.id, good);
      expect(await maint().purge(cutoff)).toEqual({ deleted: 0, anonymised: 0 });
    });
  });

  describe('recompute owners', () => {
    const depotA = { id: 'depot-a', lat: PIN.latitude, lng: PIN.longitude, serviceRadiusKm: 5 };
    const depotB = { id: 'depot-b', lat: -6.4, lng: 107.2, serviceRadiusKm: 5 };
    const maint = (depots: unknown) =>
      new B2bProspectMaintenanceService(repo, { listActive: jest.fn().mockResolvedValue(depots) } as never, config());

    it('moves a system-placed row to the depot that now serves it, and to the map when none does', async () => {
      const toB = seed({ ownerDepotId: 'depot-a', latitude: -6.4, longitude: 107.2, assignedToId: 'sales-1' });
      const stays = seed({ ownerDepotId: 'depot-a' });
      const off = seed({ ownerDepotId: 'depot-a', latitude: 10, longitude: 10 });
      const onto = seed({ ownerDepotId: null });
      expect(await maint([depotA, depotB]).recomputeOwners(marketing)).toEqual({ checked: 4, changed: 3, nowOnMap: 1 });
      expect(repo.rows.get(toB.id)).toMatchObject({ ownerDepotId: 'depot-b', assignedToId: null, ownerSource: 'AUTO' });
      expect(repo.rows.get(stays.id)!.ownerDepotId).toBe('depot-a');
      expect(repo.rows.get(off.id)!.ownerDepotId).toBeNull();
      expect(repo.rows.get(onto.id)!.ownerDepotId).toBe('depot-a');
    });

    it('never touches an HQ-set owner, a converted row or a do-not-contact row, and moves no retention clock', async () => {
      const hq = seed({ ownerDepotId: 'depot-b', ownerSource: 'HQ' });
      const conv = seed({ ownerDepotId: 'depot-b', status: 'CONVERTED' });
      const dnc = seed({ ownerDepotId: 'depot-b', status: 'DO_NOT_CONTACT' });
      const moved = seed({ ownerDepotId: 'depot-b' });
      const before = moved.lastActivityAt;
      expect(await maint([depotA]).recomputeOwners(marketing)).toEqual({ checked: 1, changed: 1, nowOnMap: 0 });
      for (const r of [hq, conv, dnc]) expect(repo.rows.get(r.id)!.ownerDepotId).toBe('depot-b');
      expect(repo.rows.get(moved.id)!.lastActivityAt).toEqual(before);
    });

    it('ABORTS and changes nothing when depot-service is down or knows no depot', async () => {
      const p = seed({ ownerDepotId: 'depot-a' });
      for (const down of [null, []]) {
        await expect(maint(down).recomputeOwners(marketing)).rejects.toThrow(ServiceUnavailableException);
      }
      expect(repo.rows.get(p.id)!.ownerDepotId).toBe('depot-a');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a depot-scoped caller (403) and audits counts only', async () => {
      await expect(maint([depotA]).recomputeOwners(kepalaA)).rejects.toThrow(ForbiddenException);
      seed();
      await maint([depotA]).recomputeOwners(marketing);
      expect(auditBodies()[0]).toMatchObject({ action: 'b2b.prospect.recompute-owners', metadata: { checked: 1, changed: 0, nowOnMap: 0 } });
    });

    it('does not count a row that changed under it (HQ took it meanwhile)', async () => {
      seed({ ownerDepotId: 'depot-b' });
      jest.spyOn(repo, 'moveOwner').mockResolvedValue(false);
      expect(await maint([depotA]).recomputeOwners(marketing)).toEqual({ checked: 1, changed: 0, nowOnMap: 0 });
    });

    it('walks more than one batch', async () => {
      for (let i = 0; i < 501; i++) seed({ ownerDepotId: 'depot-a' });
      expect(await maint([depotA]).recomputeOwners(marketing)).toEqual({ checked: 501, changed: 0, nowOnMap: 0 });
    });
  });
});
