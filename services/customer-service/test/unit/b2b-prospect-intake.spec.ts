import { ServiceUnavailableException } from '@nestjs/common';

import { loadCustomRoles, loadOverrides } from '@hydromart/access';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import {
  B2bProspectIntakeService,
  IntakeRow,
} from '../../src/application/services/b2b-prospect-intake.service';
import { ProspectInvalidError, ProspectNotFoundError, ProspectRefusedError } from '../../src/domain/errors';
import { dncHash, placeKeys } from '../../src/domain/b2b-prospect-keys';
import { RegionLookup } from '../../src/infrastructure/geo/region-lookup';
import { InMemoryProspectRepository, prospect } from '../support/b2b-fakes';
import { buildTestConfig } from '../support/fakes';

const SECRET = 'test-prospect-dnc-hmac-key-32-chars-long';
const user = { sub: 'hq-1', role: Role.MARKETING, phone: null, depotId: null } as unknown as AuthenticatedUser;

// A 3x1 degree box around (6, -6.5) stands in for one kecamatan/kelurahan.
const sq = [5, -7, 8, -7, 8, -6, 5, -6, 5, -7];
const regions = new RegionLookup({
  adm3: [{ c: '320101', n: 'Kec', b: [5, -7, 8, -6], g: [[sq]] }],
  adm4: [{ c: '3201010001', n: 'Kel', p: '320101', b: [5, -7, 8, -6], g: [[sq]] }],
});
const depotA = { id: 'depot-a', lat: -6.5, lng: 6.001, serviceRadiusKm: 5 };

const row = (over: Partial<IntakeRow> = {}): IntakeRow => ({
  name: 'Kos Melati',
  category: 'kos',
  lat: -6.5,
  lng: 6,
  phone: '0812-0000-0001',
  source: 'osm',
  license: 'ODbL-1.0',
  sourceId: 'node/1',
  ...over,
});

describe('B2bProspectIntakeService', () => {
  let repo: InMemoryProspectRepository;
  let identity: { customerIdByPhone: jest.Mock };
  let listActive: jest.Mock;
  let svc: B2bProspectIntakeService;

  const make = (withRegions = true) => {
    repo = new InMemoryProspectRepository();
    identity = { customerIdByPhone: jest.fn().mockResolvedValue(null) };
    listActive = jest.fn().mockResolvedValue([depotA]);
    svc = new B2bProspectIntakeService(
      repo,
      identity as never,
      { listActive } as never,
      buildTestConfig(),
      withRegions ? regions : undefined,
    );
  };
  beforeEach(() => make());

  const file = (rows: IntakeRow[], dryRun = false, costIdr = 0) => svc.importFile(user, { dryRun, costIdr, rows });

  describe('shape', () => {
    it.each([
      ['no name', { name: '   ' }, 'Nama usaha wajib diisi'],
      ['a name that is only a business-type word list', { name: '!!!' }, 'Nama usaha wajib diisi'],
      ['a missing name', { name: undefined as never }, 'Nama usaha wajib diisi'],
      ['an unknown category', { category: 'hotel' }, 'Kategori "hotel" tidak dikenal'],
      ['a missing category', { category: undefined as never }, 'tidak dikenal'],
      ['no pin', { lat: undefined as never, lng: undefined as never }, 'Pin lokasi wajib'],
      ['a 0,0 pin', { lat: 0, lng: 0 }, 'Pin lokasi wajib'],
      ['an out-of-range pin', { lat: 91 }, 'Pin lokasi wajib'],
      ['an out-of-range longitude', { lng: 181 }, 'Pin lokasi wajib'],
      ['a NaN pin', { lat: NaN }, 'Pin lokasi wajib'],
      ['a phone that is not a number', { phone: 'abc' }, 'Nomor telepon tidak valid'],
    ])('fails the row for %s', async (_n, over, message) => {
      const res = await file([row(over as Partial<IntakeRow>)]);
      expect(res).toMatchObject({ failed: 1, created: 0 });
      expect(res.results[0]!.message).toContain(message);
      expect(repo.rows.size).toBe(0);
    });

    it('accepts a category in any case and a row with no phone', async () => {
      const res = await file([row({ category: 'Tempat_Ibadah', phone: ' ', sourceId: undefined })]);
      expect(res.created).toBe(1);
      expect([...repo.rows.values()][0]).toMatchObject({ category: 'TEMPAT_IBADAH', phoneE164: null });
    });
  });

  describe('refusal 1: licence', () => {
    it.each([
      ['a google licence', { license: 'google' }],
      ['an empty licence', { license: '' }],
      ['no licence', { license: undefined }],
      ['a scrape source', { source: 'scrape' }],
      ['an unknown source', { source: 'bing' }],
      ['no source', { source: undefined as never }],
      ['FIELD from a file', { source: 'field', license: undefined }],
      ['an osm row carrying only an Apache licence', { license: 'Apache-2.0' }],
    ])('refuses %s', async (_n, over) => {
      const res = await file([row(over as Partial<IntakeRow>)]);
      expect(res).toMatchObject({ skipped: 1, created: 0, reasons: { LICENCE: 1 } });
      expect(res.results[0]).toMatchObject({ status: 'skipped', reason: 'LICENCE' });
      expect(repo.rows.size).toBe(0);
    });

    it('takes our own data without a licence', async () => {
      const res = await file([row({ source: 'internal', license: undefined })]);
      expect(res.created).toBe(1);
    });

    it('takes an Overture row whose phone came from OSM', async () => {
      const res = await file([row({ source: 'overture', license: 'CDLA-Permissive-2.0;ODbL-1.0' })]);
      expect(res.created).toBe(1);
    });
  });

  describe('refusal 2: do-not-contact', () => {
    it('refuses a phone on the list, reported as that and not as a duplicate of its own wiped row', async () => {
      await repo.addDnc([{ kind: 'PHONE', keyHash: dncHash(SECRET, 'PHONE', '+6281200000001') }]);
      repo.rows.set('x', prospect({ phoneE164: null, nameKey: 'kosmelati', latitude: -6.5, longitude: 6, status: 'DO_NOT_CONTACT' }));
      const res = await file([row()]);
      expect(res).toMatchObject({ skipped: 1, reasons: { DO_NOT_CONTACT: 1, DUPLICATE: 0 } });
    });

    it('refuses a business by name in the pin cell, and in a neighbouring cell', async () => {
      const cell = '-723:666';
      await repo.addDnc([{ kind: 'PLACE', keyHash: dncHash(SECRET, 'PLACE', placeKeys('kosmelati', cell)[0]!) }]);
      const res = await file([row({ phone: undefined, sourceId: 'node/9' })]);
      expect(res.reasons.DO_NOT_CONTACT).toBe(1);
    });

    it('survives a re-import of the same file', async () => {
      await repo.addDnc([{ kind: 'PHONE', keyHash: dncHash(SECRET, 'PHONE', '+6281200000001') }]);
      for (let i = 0; i < 2; i++) expect((await file([row()])).reasons.DO_NOT_CONTACT).toBe(1);
    });
  });

  describe('refusal 3: already a customer', () => {
    it('refuses a mobile number that owns an account (an ACTIVE or PENDING one alike)', async () => {
      identity.customerIdByPhone.mockResolvedValue('cust-1');
      const res = await file([row()]);
      expect(res).toMatchObject({ skipped: 1, reasons: { ALREADY_CUSTOMER: 1 } });
      expect(identity.customerIdByPhone).toHaveBeenCalledWith('+6281200000001');
    });

    it('cannot match a landline or no phone, and does not ask for it (accepted ceiling)', async () => {
      const res = await file([row({ phone: '021 5551234', sourceId: 'a' }), row({ phone: undefined, name: 'Lain', sourceId: 'b' })]);
      expect(res.created).toBe(2);
      expect(identity.customerIdByPhone).not.toHaveBeenCalled();
    });

    it('fails the row, never passes it, when auth-service does not answer', async () => {
      identity.customerIdByPhone.mockRejectedValue(new ServiceUnavailableException('auth-service tidak menjawab'));
      const res = await file([row()]);
      expect(res).toMatchObject({ failed: 1, created: 0 });
      expect(res.results[0]!.message).toContain('auth-service');
      expect(repo.rows.size).toBe(0);
    });
  });

  describe('refusal 4: duplicate', () => {
    it('refuses a dataset row that is already in, whatever its status', async () => {
      repo.rows.set('x', prospect({ source: 'OSM', sourceId: 'node/1', phoneE164: '+6289999999999', nameKey: 'lain', status: 'LOST' }));
      expect((await file([row()])).reasons.DUPLICATE).toBe(1);
    });

    it('refuses the same phone, and the same name within 150 m but not 400 m away', async () => {
      repo.rows.set('x', prospect({ phoneE164: '+6281200000001', nameKey: 'lain', sourceId: 'other' }));
      expect((await file([row({ sourceId: 'z1' })])).reasons.DUPLICATE).toBe(1);

      make();
      repo.rows.set('y', prospect({ phoneE164: null, nameKey: 'kosmelati', latitude: -6.5005, longitude: 6, sourceId: 'p' }));
      expect((await file([row({ phone: undefined, sourceId: 'z2' })])).reasons.DUPLICATE).toBe(1);

      make();
      repo.rows.set('y', prospect({ phoneE164: null, nameKey: 'kosmelati', latitude: -6.504, longitude: 6, sourceId: 'p' }));
      expect((await file([row({ phone: undefined, sourceId: 'z3' })])).created).toBe(1);
    });

    it('catches a duplicate inside the file, in a dry run and in a commit alike', async () => {
      const rows = [row(), row({ phone: undefined, sourceId: 'node/2' }), row({ name: 'Lain', phone: '0812-0000-0002', sourceId: 'node/1' })];
      const dry = await file(rows, true);
      expect(dry.created).toBe(1);
      expect(dry.reasons.DUPLICATE).toBe(2);
      const commit = await file(rows, false);
      expect(commit.created).toBe(1);
      expect(commit.reasons.DUPLICATE).toBe(2);
    });

    it('answers a lost write race as a duplicate, not an error', async () => {
      jest.spyOn(repo, 'createGuarded').mockResolvedValueOnce({ ok: false, reason: 'DUPLICATE' });
      expect((await file([row()])).reasons.DUPLICATE).toBe(1);
      jest.spyOn(repo, 'createGuarded').mockResolvedValueOnce({ ok: false, reason: 'DO_NOT_CONTACT' });
      expect((await file([row({ sourceId: 'q' })])).reasons.DO_NOT_CONTACT).toBe(1);
    });
  });

  describe('owner depot', () => {
    it('is the nearest depot that serves the pin, with region codes', async () => {
      await file([row()]);
      expect([...repo.rows.values()][0]).toMatchObject({
        ownerDepotId: 'depot-a',
        kecamatanCode: '320101',
        kelurahanCode: '3201010001',
        gridCell: '-723:666',
        source: 'OSM',
        licence: 'ODbL-1.0',
      });
    });

    it('keeps an out-of-area row with no owner (the map) instead of refusing it', async () => {
      const res = await file([row({ lat: -6.9, lng: 7.5 })]);
      expect(res.created).toBe(1);
      expect([...repo.rows.values()][0]!.ownerDepotId).toBeNull();
    });

    it('fails every row, never silently parks it on the map, when depot-service does not answer', async () => {
      listActive.mockResolvedValue(null);
      const res = await file([row(), row({ sourceId: 'b', phone: undefined, name: 'Lain' })]);
      expect(res).toMatchObject({ failed: 2, created: 0 });
      expect(res.results[0]!.message).toContain('depot-service');
      expect(listActive).toHaveBeenCalledTimes(1);
      expect(repo.rows.size).toBe(0);
    });

    it('works without the region asset (no codes) and stores the dataset vintage', async () => {
      make(false);
      await file([row({ sourceUpdated: '2026-10-05', sourceDataset: 'Meta' }), row({ name: 'Dua', phone: undefined, sourceId: '2', sourceUpdated: 'soon' })]);
      const [a, b] = [...repo.rows.values()];
      expect(a).toMatchObject({ kecamatanCode: null, kelurahanCode: null, sourceDataset: 'Meta' });
      expect(a!.sourceDate!.toISOString()).toBe('2026-10-05T00:00:00.000Z');
      expect(b!.sourceDate).toBeNull();
    });
  });

  describe('import file', () => {
    it('gives a dry run exactly the verdicts a commit gives, and writes nothing', async () => {
      identity.customerIdByPhone.mockImplementation(async (p: string) => (p.endsWith('3') ? 'c' : null));
      repo.rows.set('x', prospect({ source: 'OSM', sourceId: 'node/5', nameKey: 'zzz', phoneE164: null, latitude: 1, longitude: 1 }));
      await repo.addDnc([{ kind: 'PHONE', keyHash: dncHash(SECRET, 'PHONE', '+6281200000004') }]);
      const rows = [
        row({ sourceId: '1', phone: '0812-0000-0001', name: 'Satu' }),
        row({ sourceId: '2', phone: '0812-0000-0002', name: 'Dua', license: 'google' }),
        row({ sourceId: '3', phone: '0812-0000-0003', name: 'Tiga' }),
        row({ sourceId: '4', phone: '0812-0000-0004', name: 'Empat' }),
        row({ sourceId: 'node/5', phone: undefined, name: 'Lima' }),
        row({ sourceId: '6', phone: undefined, name: 'Enam', lat: 0, lng: 0 }),
        row({ sourceId: '7', phone: undefined, name: 'Tujuh', lat: -6.9, lng: 7.5 }),
      ];
      const before = repo.rows.size;
      const dry = await file(rows, true);
      expect(repo.rows.size).toBe(before);
      expect(repo.batches).toHaveLength(0);
      const commit = await file(rows, false);
      const verdict = (s: typeof dry) => s.results.map((r) => [r.status, r.reason ?? null]);
      expect(verdict(dry)).toEqual(verdict(commit));
      expect(verdict(commit)).toEqual([
        ['created', null],
        ['skipped', 'LICENCE'],
        ['skipped', 'ALREADY_CUSTOMER'],
        ['skipped', 'DO_NOT_CONTACT'],
        ['skipped', 'DUPLICATE'],
        ['failed', null],
        ['created', null],
      ]);
      expect(commit.reasons).toEqual({ LICENCE: 1, DO_NOT_CONTACT: 1, ALREADY_CUSTOMER: 1, DUPLICATE: 1 });
      expect(dry.dryRun).toBe(true);
      expect(commit.dryRun).toBe(false);
    });

    it('logs one batch with the counts and the cost, and the rows carry its id', async () => {
      const res = await file([row(), row({ license: 'google', sourceId: 'g' }), row({ lat: 0, lng: 0, sourceId: 'h' })], false, 0);
      expect(repo.batches).toHaveLength(1);
      expect(repo.batches[0]).toMatchObject({
        sources: 'osm',
        licences: 'ODbL-1.0,google',
        rows: 3,
        created: 1,
        refused: 1,
        failed: 1,
        costIdr: 0,
        importedById: 'hq-1',
      });
      expect([...repo.rows.values()][0]!.batchId).toBe(repo.batches[0]!.id);
      expect(res.created).toBe(1);
    });

    it('records the cost the file was bought for, and tolerates a row with no licence in the log', async () => {
      await file([row({ license: undefined })], false, 150000);
      expect(repo.batches[0]).toMatchObject({ costIdr: 150000, licences: '' });
    });

    it('never lets an out-of-area row near a work list: it stays on the map scope only', async () => {
      await file([row({ lat: -6.9, lng: 7.5 })]);
      expect((await repo.list({ scope: 'work', limit: 10 })).items).toHaveLength(0);
      expect((await repo.list({ scope: 'map', limit: 10 })).items).toHaveLength(1);
    });
  });

  describe('field find', () => {
    const field = { name: 'Bengkel Jaya', category: 'bengkel', lat: -6.5, lng: 6, phone: '0812-0000-0009' };

    it('creates with source FIELD whatever else is said, owned by the rule and not by the creator', async () => {
      const made = await svc.createField(user, { ...field, source: 'osm', license: 'google' } as never);
      expect(made).toMatchObject({ source: 'FIELD', licence: null, ownerDepotId: 'depot-a', createdById: 'hq-1', status: 'NEW' });
      const out = await svc.createField(user, { ...field, name: 'Salon Cantik', phone: undefined, lat: -6.9, lng: 7.5 });
      expect(out.ownerDepotId).toBeNull();
    });

    it('answers a refusal as 409 with its reason, an unreadable row as 422', async () => {
      await svc.createField(user, field);
      await expect(svc.createField(user, field)).rejects.toMatchObject({ reason: 'DUPLICATE', status: 409, details: { reason: 'DUPLICATE' } });
      await expect(svc.createField(user, field)).rejects.toBeInstanceOf(ProspectRefusedError);
      await expect(svc.createField(user, { ...field, lat: 0, lng: 0 })).rejects.toBeInstanceOf(ProspectInvalidError);
    });

    it('answers a lost race as the refusal it is', async () => {
      jest.spyOn(repo, 'createGuarded').mockResolvedValueOnce({ ok: false, reason: 'DO_NOT_CONTACT' });
      await expect(svc.createField(user, field)).rejects.toMatchObject({ reason: 'DO_NOT_CONTACT' });
      jest.spyOn(repo, 'createGuarded').mockResolvedValueOnce({ ok: false, reason: 'DUPLICATE' });
      await expect(svc.createField(user, field)).rejects.toMatchObject({ reason: 'DUPLICATE' });
    });
  });

  describe('field find by a Work-only caller (Sales Depot)', () => {
    const field = { name: 'Bengkel Jaya', category: 'bengkel', lat: -6.5, lng: 6, phone: '0812-0000-0009' };
    const sales = (depotIds: string[]) =>
      ({ sub: 'sales-1', role: 'C_sales', phone: null, depotId: depotIds[0], depotIds }) as unknown as AuthenticatedUser;
    beforeAll(() => {
      loadCustomRoles([{ key: 'C_sales', name: 'Sales Depot', scope: 'LOCKED' }]);
      loadOverrides({ b2bProspectWork: ['C_sales'] });
    });
    afterAll(() => {
      loadOverrides({});
      loadCustomRoles([]);
    });

    it('creates a row in its own depot and assigns it to itself', async () => {
      const made = await svc.createField(sales(['depot-a']), field);
      expect(made).toMatchObject({ source: 'FIELD', ownerDepotId: 'depot-a', assignedToId: 'sales-1' });
      expect(made.assignedAt).toBeInstanceOf(Date);
    });

    it('refuses with the reach 404 when the owner depot is another depot, writing nothing', async () => {
      await expect(svc.createField(sales(['depot-z']), field)).rejects.toBeInstanceOf(ProspectNotFoundError);
      expect(repo.rows.size).toBe(0);
    });

    it('refuses with the same 404 when the pin belongs to no depot', async () => {
      await expect(svc.createField(sales(['depot-a']), { ...field, lat: -6.9, lng: 7.5 })).rejects.toBeInstanceOf(ProspectNotFoundError);
    });

    it('keeps the four refusals for a Work-only caller too', async () => {
      await svc.createField(sales(['depot-a']), field);
      await expect(svc.createField(sales(['depot-a']), field)).rejects.toBeInstanceOf(ProspectRefusedError);
      await expect(svc.createField(sales(['depot-a']), { ...field, lat: 0, lng: 0 })).rejects.toBeInstanceOf(ProspectInvalidError);
    });

    it('leaves a Manage holder unassigned and free of the depot rule', async () => {
      const made = await svc.createField(user, { ...field, lat: -6.9, lng: 7.5, phone: undefined });
      expect(made).toMatchObject({ ownerDepotId: null, assignedToId: null });
    });
  });

  describe('review fixes', () => {
    const fieldRow = { name: 'Bengkel Jaya', category: 'bengkel', lat: -6.5, lng: 6, phone: '0812-0000-0009' };
    const kepala = { sub: 'kepala-a', role: Role.KEPALA_DEPOT, phone: null, depotId: 'depot-a', depotIds: ['depot-a'] } as unknown as AuthenticatedUser;
    const bodies = () => (global.fetch as jest.Mock).mock.calls.filter(([u]) => String(u).includes('/audit/internal')).map(([, i]) => JSON.parse(i.body));

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never;
      svc = new B2bProspectIntakeService(
        repo,
        identity as never,
        { listActive } as never,
        buildTestConfig({ AUTH_SERVICE_URL: 'http://auth.test', INTERNAL_SERVICE_KEY: 'internal-key-01' }),
        regions,
      );
    });

    it('gives a depot-scoped caller ONE generic refusal for a customer, a do-not-contact and a phone duplicate', async () => {
      const generic = { reason: 'DUPLICATE', message: 'Nomor ini tidak bisa dipakai untuk prospek baru.' };
      identity.customerIdByPhone.mockResolvedValueOnce('cust-1');
      await expect(svc.createField(kepala, fieldRow)).rejects.toMatchObject(generic);
      await repo.addDnc([{ kind: 'PHONE', keyHash: dncHash(SECRET, 'PHONE', '+6281200000009') }]);
      await expect(svc.createField(kepala, fieldRow)).rejects.toMatchObject(generic);
      repo.dnc.clear();
      repo.rows.set('x', prospect({ phoneE164: '+6281200000009', nameKey: 'lain', ownerDepotId: 'depot-z' }));
      await expect(svc.createField(kepala, fieldRow)).rejects.toMatchObject(generic);
      jest.spyOn(repo, 'createGuarded').mockResolvedValueOnce({ ok: false, reason: 'DO_NOT_CONTACT' });
      await expect(svc.createField(kepala, { ...fieldRow, phone: undefined })).rejects.toMatchObject(generic);
    });

    it('keeps the specific reason for a network-wide caller, and a name-near duplicate for everyone', async () => {
      identity.customerIdByPhone.mockResolvedValueOnce('cust-1');
      await expect(svc.createField(user, fieldRow)).rejects.toMatchObject({ reason: 'ALREADY_CUSTOMER' });
      await repo.addDnc([{ kind: 'PHONE', keyHash: dncHash(SECRET, 'PHONE', '+6281200000009') }]);
      await expect(svc.createField(user, fieldRow)).rejects.toMatchObject({ reason: 'DO_NOT_CONTACT' });
      repo.dnc.clear();
      repo.rows.set('x', prospect({ phoneE164: '+6281200000009', nameKey: 'lain' }));
      await expect(svc.createField(user, fieldRow)).rejects.toMatchObject({ reason: 'DUPLICATE', message: expect.stringContaining('dipakai prospek lain') });
      repo.rows.clear();
      repo.rows.set('y', prospect({ phoneE164: null, nameKey: 'bengkeljaya', latitude: -6.5, longitude: 6 }));
      const nearMessage = { reason: 'DUPLICATE', message: expect.stringContaining('150 m') };
      await expect(svc.createField(kepala, { ...fieldRow, phone: undefined })).rejects.toMatchObject(nearMessage);
      await expect(svc.createField(user, { ...fieldRow, phone: undefined })).rejects.toMatchObject(nearMessage);
      jest.spyOn(repo, 'createGuarded').mockResolvedValueOnce({ ok: false, reason: 'DUPLICATE' });
      await expect(svc.createField(user, { ...fieldRow, name: 'Lain', phone: undefined })).rejects.toMatchObject({ message: expect.stringContaining('baru saja') });
    });

    it('audits create and import commit with ids and counts, never a phone, name or coordinate', async () => {
      const made = await svc.createField(user, { ...fieldRow, name: 'Salon Rahasia' });
      await file([row({ name: 'Kos Rahasia', phone: '0812-7777-7777' }), row({ license: 'google', sourceId: 'g' })]);
      const [create, imp] = bodies();
      expect(create).toMatchObject({ action: 'b2b.prospect.create', actorId: 'hq-1', metadata: { prospectId: made.id, source: 'FIELD' } });
      expect(imp).toMatchObject({ action: 'b2b.prospect.import', metadata: { rows: 2, created: 1, refused: 1, failed: 0, reasons: { LICENCE: 1 } } });
      expect(JSON.stringify(bodies())).not.toMatch(/Rahasia|\+62|-6\.5/);
    });

    it('does not audit a dry run', async () => {
      await file([row()], true);
      expect(bodies()).toHaveLength(0);
    });

    it('fails a row with a fixed message, not an unknown error text, and keeps our own messages', async () => {
      jest.spyOn(repo, 'findDuplicateCandidates').mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.9:5432 secret-host'));
      const res = await file([row()]);
      expect(res.results[0]).toMatchObject({ status: 'failed', message: 'Gagal memproses baris' });
      jest.spyOn(repo, 'createGuarded').mockRejectedValueOnce(new Error('db password=xyz'));
      const res2 = await file([row({ sourceId: 'z' })]);
      expect(res2.results[0]).toMatchObject({ status: 'failed', message: 'Gagal memproses baris' });
      expect(JSON.stringify([res, res2])).not.toMatch(/ECONNREFUSED|password|secret-host/);
      identity.customerIdByPhone.mockRejectedValueOnce(new ServiceUnavailableException('Gagal menghubungi auth-service'));
      expect((await file([row({ sourceId: 'q' })])).results[0]!.message).toBe('Gagal menghubungi auth-service');
    });
  });
});
