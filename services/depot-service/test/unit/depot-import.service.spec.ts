import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, SettingsCache, StaleWriteError } from '@hydromart/platform';

import { DepotImportService } from '../../src/application/services/depot-import.service';
import { DepotService } from '../../src/application/services/depot.service';
import { SettingsService } from '../../src/application/services/settings.service';
import { DuplicateDepotCodeError } from '../../src/domain/errors';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotImportController } from '../../src/modules/depot-import.controller';
import { ImportDepotRowDto } from '../../src/modules/dto/depot.dto';
import { InMemoryDepotRepository, InMemorySettingsRepository } from '../support/fakes';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SQUARE = [
  [
    { lat: -6.2, lng: 106.8 },
    { lat: -6.2, lng: 107.0 },
    { lat: -6.0, lng: 107.0 },
    { lat: -6.0, lng: 106.8 },
  ],
];

const user = (role: string): AuthenticatedUser => ({ sub: 'u1', role }) as AuthenticatedUser;
const HQ = user('HEAD_OFFICE');
const ADMIN = user('SUPER_ADMIN');

const row = (over: Partial<ImportDepotRowDto> = {}): ImportDepotRowDto =>
  ({
    code: 'JKT-01',
    name: 'Depot Cikini',
    ownershipType: OwnershipType.HKP,
    address: 'Jl. Cikini Raya No. 1',
    city: 'Jakarta Pusat',
    province: 'DKI Jakarta',
    lat: -6.1944,
    lng: 106.8412,
    deliveryFee: 5000,
    ...over,
  }) as ImportDepotRowDto;

describe('DepotImportService', () => {
  let repo: InMemoryDepotRepository;
  let settingsRepo: InMemorySettingsRepository;
  let settings: SettingsService;
  let depots: DepotService;
  let service: DepotImportService;

  beforeEach(() => {
    repo = new InMemoryDepotRepository();
    settingsRepo = new InMemorySettingsRepository();
    settings = new SettingsService(settingsRepo as never, new SettingsCache(settingsRepo as never));
    depots = new DepotService(repo);
    service = new DepotImportService(depots, repo, settings);
  });

  const statuses = (r: { results: { status: string }[] }) => r.results.map((x) => x.status);

  describe('create', () => {
    it('creates a fully specified depot: fields, hours, holidays, drawn area and settings', async () => {
      const out = await service.import(
        'create',
        [
          row({
            serviceRadiusKm: 8,
            minOrderAmount: 20000,
            contactPhone: '081234567890',
            operatingHours: {
              mon: { open: '08:00', close: '20:00', breakStart: '12:00', breakEnd: '13:00' },
            },
            holidays: [{ date: '2026-08-17', label: 'Kemerdekaan' }],
            serviceArea: SQUARE,
            settings: { gallonDepositIdr: 25000, gallonMaxHoldDays: '10' },
          }),
        ],
        HQ,
      );
      expect(out).toMatchObject({ created: 1, failed: 0 });
      const saved = repo.rows[0];
      expect(saved).toMatchObject({
        code: 'JKT-01',
        serviceRadiusKm: 8,
        minOrderAmount: 20000,
        contactPhone: '081234567890',
        operatingHours: {
          mon: { open: '08:00', close: '20:00', breakStart: '12:00', breakEnd: '13:00' },
        },
        holidays: [{ date: '2026-08-17', label: 'Kemerdekaan' }],
        serviceArea: SQUARE,
      });
      const effective = (await settings.schema(saved.id)).effective;
      expect(effective.gallonDepositIdr).toBe(25000);
      expect(effective.gallonMaxHoldDays).toBe(10);
      expect(settingsRepo.rows.every((r) => r.updatedBy === 'u1')).toBe(true);
    });

    it('defaults the radius to 5 km and everything optional to empty', async () => {
      await service.import('create', [row()], HQ);
      expect(repo.rows[0]).toMatchObject({
        serviceRadiusKm: 5,
        minOrderAmount: null,
        ownerId: null,
        operatingHours: {},
        holidays: [],
        serviceArea: null,
      });
    });

    it('skips a code that already exists and leaves it untouched', async () => {
      await depots.create({
        ...repo.rows[0],
        ...row(),
        minOrderAmount: null,
        ownerId: null,
        operatingHours: {},
        holidays: [],
      } as never);
      const before = { ...repo.rows[0] };
      const out = await service.import('create', [row({ name: 'Changed' })], HQ);
      expect(statuses(out)).toEqual(['skipped']);
      expect(out.results[0].message).toContain('sudah ada');
      expect(repo.rows[0]).toEqual(before);
    });

    it('names every missing required cell on a new depot', async () => {
      const out = await service.import('create', [{ code: 'X-1' } as ImportDepotRowDto], HQ);
      expect(out.results[0].status).toBe('failed');
      expect(out.results[0].message).toContain('nama');
      expect(out.results[0].message).toContain('ongkir');
      expect(repo.rows).toHaveLength(0);
    });

    it.each([
      ['a blank code', { code: '   ' }, 'Kode depot kosong'],
      ['a swapped lat/lng', { lat: 106.8, lng: -6.19 }, 'tertukar'],
      ['a longitude outside Indonesia', { lng: 10 }, 'lng 10'],
      ['a franchise depot with no owner', { ownershipType: OwnershipType.WARALABA }, ''],
      [
        'bad hours',
        { operatingHours: { mon: { open: '9am', close: '17:00' } } },
        'Jam operasional',
      ],
      ['bad holidays', { holidays: [{ date: '2026-02-30' }] }, 'Hari libur'],
      [
        'a self-crossing area',
        {
          serviceArea: [
            [
              { lat: 0, lng: 0 },
              { lat: 1, lng: 1 },
              { lat: 0, lng: 1 },
              { lat: 1, lng: 0 },
            ],
          ],
        },
        'Area layanan',
      ],
      ['an unknown setting', { settings: { nope: 1 } }, 'Unknown setting'],
      [
        'a fractional whole-number setting',
        { settings: { gallonMaxHoldDays: 1.5 } },
        'whole number',
      ],
      ['a setting above its max', { settings: { gallonMaxHoldDays: 999 } }, 'above max'],
    ])('fails %s without creating anything', async (_n, over, msg) => {
      const out = await service.import('create', [row(over as Partial<ImportDepotRowDto>)], HQ);
      expect(out.results[0].status).toBe('failed');
      expect(out.results[0].message).toContain(msg);
      expect(repo.rows).toHaveLength(0);
      expect(settingsRepo.rows).toHaveLength(0);
    });

    it('lets a franchise depot through when it names an owner', async () => {
      const out = await service.import(
        'create',
        [row({ ownershipType: OwnershipType.WARALABA, ownerId: OWNER })],
        HQ,
      );
      expect(out.created).toBe(1);
      expect(repo.rows[0].ownerId).toBe(OWNER);
    });

    it('rejects a setting the caller may not write, before the depot is created', async () => {
      const refused = await service.import(
        'create',
        [row({ settings: { approvalAutoPassIdr: 500000 } })],
        user('MANAGER'),
      );
      expect(refused.results[0].status).toBe('failed');
      expect(refused.results[0].message).toContain('hak akses');
      expect(repo.rows).toHaveLength(0);

      const allowed = await service.import(
        'create',
        [row({ settings: { approvalAutoPassIdr: 500000 } })],
        HQ,
      );
      expect(allowed.created).toBe(1);
    });

    it('skips blank settings and keeps going after a bad row', async () => {
      const out = await service.import(
        'create',
        [
          row({ code: 'A', settings: { gallonDepositIdr: '', gallonMaxHoldDays: null } }),
          row({ code: 'B', lat: 500 as never }),
          row({ code: 'C' }),
        ],
        HQ,
      );
      expect(statuses(out)).toEqual(['created', 'failed', 'created']);
      expect(settingsRepo.rows).toHaveLength(0);
    });

    it('fails a code repeated in the file, ignoring case, and names the first row', async () => {
      const out = await service.import(
        'create',
        [row({ code: 'JKT-01' }), row({ code: 'jkt-01' }), row({ code: 'JKT-01 ' })],
        HQ,
      );
      expect(statuses(out)).toEqual(['created', 'failed', 'failed']);
      expect(out.results[1].message).toContain('baris 1');
      expect(repo.rows).toHaveLength(1);
    });

    it('trims the code before it is stored', async () => {
      await service.import('create', [row({ code: '  JKT-09  ' })], HQ);
      expect(repo.rows[0].code).toBe('JKT-09');
    });

    it('reports a code that was taken between the lookup and the write as skipped', async () => {
      jest.spyOn(depots, 'create').mockRejectedValue(new DuplicateDepotCodeError());
      const out = await service.import('create', [row()], HQ);
      expect(statuses(out)).toEqual(['skipped']);
    });

    it('says the depot is already saved when its settings then fail to write', async () => {
      jest.spyOn(settings, 'put').mockRejectedValue(new Error('db down'));
      const out = await service.import(
        'create',
        [row({ settings: { gallonDepositIdr: 25000 } })],
        HQ,
      );
      expect(out.results[0].status).toBe('failed');
      expect(out.results[0].message).toContain('JKT-01 tersimpan');
      expect(out.results[0].message).toContain('db down');
      expect(repo.rows).toHaveLength(1);
    });

    it('words a non-Error settings failure too', async () => {
      jest.spyOn(settings, 'put').mockRejectedValue('boom');
      const out = await service.import(
        'create',
        [row({ settings: { gallonDepositIdr: 25000 } })],
        HQ,
      );
      expect(out.results[0].message).toContain('gagal: gagal');
    });
  });

  describe('upsert', () => {
    beforeEach(async () => {
      await service.import(
        'create',
        [
          row({
            contactPhone: '081234567890',
            paymentBankName: 'BCA',
            operatingHours: { mon: { open: '08:00', close: '20:00' } },
            holidays: [{ date: '2026-08-17' }],
            serviceArea: SQUARE,
          }),
        ],
        ADMIN,
      );
    });

    it('updates only the cells that are filled and never clears with a blank', async () => {
      const out = await service.import(
        'upsert',
        [{ code: 'JKT-01', city: 'Jakarta Selatan', deliveryFee: 7000 } as ImportDepotRowDto],
        ADMIN,
      );
      expect(statuses(out)).toEqual(['updated']);
      expect(repo.rows[0]).toMatchObject({
        city: 'Jakarta Selatan',
        deliveryFee: 7000,
        name: 'Depot Cikini',
        contactPhone: '081234567890',
        paymentBankName: 'BCA',
        operatingHours: { mon: { open: '08:00', close: '20:00' } },
        holidays: [{ date: '2026-08-17' }],
        serviceArea: SQUARE,
      });
    });

    it('creates the codes that do not exist yet in the same file', async () => {
      const out = await service.import(
        'upsert',
        [row({ code: 'NEW-1' }), { code: 'JKT-01', city: 'Depok' } as ImportDepotRowDto],
        ADMIN,
      );
      expect(statuses(out)).toEqual(['created', 'updated']);
    });

    it('replaces hours and holidays wholesale when given, and clears the drawn area with an empty list', async () => {
      await service.import(
        'upsert',
        [
          {
            code: 'JKT-01',
            operatingHours: { tue: { open: '09:00', close: '17:00' } },
            holidays: [],
            serviceArea: [],
          } as unknown as ImportDepotRowDto,
        ],
        ADMIN,
      );
      expect(repo.rows[0].operatingHours).toEqual({ tue: { open: '09:00', close: '17:00' } });
      expect(repo.rows[0].holidays).toEqual([]);
      expect(repo.rows[0].serviceArea).toBeNull();
    });

    it('writes a setting alone without touching the depot row', async () => {
      const stamp = repo.rows[0].updatedAt;
      const out = await service.import(
        'upsert',
        [{ code: 'JKT-01', settings: { gallonDepositIdr: 30000 } } as unknown as ImportDepotRowDto],
        ADMIN,
      );
      expect(statuses(out)).toEqual(['updated']);
      expect(repo.rows[0].updatedAt).toBe(stamp);
      expect((await settings.schema(repo.rows[0].id)).effective.gallonDepositIdr).toBe(30000);
    });

    it('skips a row that fills nothing in', async () => {
      const out = await service.import(
        'upsert',
        [{ code: 'JKT-01', settings: { gallonDepositIdr: '' } } as unknown as ImportDepotRowDto],
        ADMIN,
      );
      expect(statuses(out)).toEqual(['skipped']);
      expect(out.results[0].message).toContain('Tidak ada kolom');
    });

    it('keeps the franchise-owner rule when an update flips the type', async () => {
      const out = await service.import(
        'upsert',
        [{ code: 'JKT-01', ownershipType: OwnershipType.WARALABA } as ImportDepotRowDto],
        ADMIN,
      );
      expect(out.results[0].status).toBe('failed');
      expect(repo.rows[0].ownershipType).toBe(OwnershipType.HKP);
    });

    it('refuses to overwrite a depot someone edited after the file was read', async () => {
      const stale = {
        ...repo.rows[0],
        updatedAt: new Date(repo.rows[0].updatedAt.getTime() - 1000),
      };
      jest.spyOn(repo, 'findManyByCodes').mockResolvedValue([stale]);
      const out = await service.import(
        'upsert',
        [{ code: 'JKT-01', city: 'Depok' } as ImportDepotRowDto],
        ADMIN,
      );
      expect(out.results[0].status).toBe('failed');
      expect(out.results[0].message).toBe(new StaleWriteError().message);
      expect(repo.rows[0].city).toBe('Jakarta Pusat');
    });

    it('validates an update row as strictly as a new one', async () => {
      const out = await service.import(
        'upsert',
        [
          { code: 'JKT-01', lat: -200 } as ImportDepotRowDto,
          { code: 'JKT-01x', lat: 106 } as ImportDepotRowDto,
        ],
        ADMIN,
      );
      expect(out.results[0].status).toBe('failed');
      expect(out.results[1].status).toBe('failed');
      expect(repo.rows[0].lat).toBe(-6.1944);
    });
  });

  describe('audit', () => {
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
      jest.restoreAllMocks();
    });

    it('records one summary entry per import, with the counts', async () => {
      process.env.AUTH_SERVICE_URL = 'http://auth:3001';
      process.env.INTERNAL_SERVICE_KEY = 'k';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as never;
      await service.import('create', [row(), row({ code: 'B', lat: 500 as never })], HQ);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toMatchObject({
        action: 'depot.import',
        actorId: 'u1',
        metadata: { mode: 'create', created: 1, failed: 1, updated: 0, skipped: 0 },
      });
    });
  });
});

describe('DepotImportController', () => {
  const summary = { created: 0, updated: 0, skipped: 0, failed: 0, results: [] };
  const make = () => {
    const imports = { import: jest.fn().mockResolvedValue(summary) };
    return { imports, controller: new DepotImportController(imports as never) };
  };

  it('lets head office create but not update', async () => {
    const { controller, imports } = make();
    await expect(controller.import({ mode: 'create', rows: [] }, HQ)).resolves.toBe(summary);
    expect(() => controller.import({ mode: 'upsert', rows: [] }, HQ)).toThrow(ForbiddenException);
    expect(imports.import).toHaveBeenCalledTimes(1);
  });

  it('lets the superuser update', async () => {
    const { controller, imports } = make();
    await controller.import({ mode: 'upsert', rows: [] }, ADMIN);
    expect(imports.import).toHaveBeenCalledWith('upsert', [], ADMIN);
  });
});
