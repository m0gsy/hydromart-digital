import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CAPABILITIES, can } from '@hydromart/access';
import { AuthenticatedUser, CAPABILITY_KEY, InternalAuthGuard, Role } from '@hydromart/platform';

import { B2bProspectController } from '../../src/modules/b2b-prospect.controller';
import {
  AssigneesQueryDto,
  AssignProspectDto,
  ConvertProspectDto,
  CreateProspectDto,
  ExportProspectsDto,
  ImportProspectRowDto,
  ImportProspectsDto,
  ProspectListQueryDto,
  PurgeProspectsDto,
  SetOwnerDepotDto,
  SuppressDto,
  VisitProspectDto,
} from '../../src/modules/dto/b2b-prospect.dto';

const user = { sub: 'u1', role: Role.MARKETING, phone: null, depotId: null } as unknown as AuthenticatedUser;

/** Every route of the controller, with the ONE capability it must carry. */
const ROUTES: Record<string, string | null> = {
  list: 'b2bProspectRead',
  mine: 'b2bProspectWork',
  coverage: 'b2bProspectRead',
  assignees: 'b2bProspectManage',
  get: 'b2bProspectWork',
  create: 'b2bProspectManage',
  import: 'b2bProspectImport',
  // a person's objection is global and wipes rows in every depot, so it is a manager's route, not a salesperson's
  suppress: 'b2bProspectManage',
  setStatus: 'b2bProspectWork',
  assign: 'b2bProspectManage',
  setOwnerDepot: 'b2bProspectReassign',
  suppressProspect: 'b2bProspectWork',
  visit: 'b2bProspectWork',
  convert: 'b2bProspectWork',
  export: 'b2bProspectExport',
  recomputeOwners: 'b2bProspectImport',
  // the nightly retention sweep: the internal key, not a console session, so no capability
  purge: null,
};

describe('B2bProspectController', () => {
  const prospects = {
    list: jest.fn(),
    mine: jest.fn(),
    coverage: jest.fn(),
    assignees: jest.fn(),
    get: jest.fn(),
    suppress: jest.fn(),
    setStatus: jest.fn(),
    assign: jest.fn(),
    setOwnerDepot: jest.fn(),
    suppressProspect: jest.fn(),
    convert: jest.fn(),
  };
  const intake = { createField: jest.fn(), importFile: jest.fn() };
  const visits = { visit: jest.fn() };
  const exporter = { export: jest.fn() };
  const maintenance = { purge: jest.fn(), recomputeOwners: jest.fn() };
  const c = new B2bProspectController(prospects as never, intake as never, visits as never, exporter as never, maintenance as never);
  beforeEach(() => jest.clearAllMocks());

  it('has @Can on every route, exactly the one capability each is meant to need', () => {
    const proto = B2bProspectController.prototype as unknown as Record<string, unknown>;
    const routes = Object.getOwnPropertyNames(proto).filter(
      (k) => k !== 'constructor' && Reflect.hasMetadata('path', proto[k] as object),
    );
    expect(routes.sort()).toEqual(Object.keys(ROUTES).sort());
    for (const r of routes) {
      expect(Reflect.getMetadata(CAPABILITY_KEY, proto[r] as object)).toBe(ROUTES[r] ?? undefined);
    }
    // the one route without a capability is guarded by the internal key
    expect(Reflect.getMetadata('__guards__', proto['purge'] as object)).toContain(InternalAuthGuard);
  });

  it('keeps the static routes ahead of `:id` and serves under /b2b-prospects v1', () => {
    expect(Reflect.getMetadata('path', B2bProspectController)).toBe('b2b-prospects');
    const order = Object.getOwnPropertyNames(B2bProspectController.prototype);
    expect(order.indexOf('mine')).toBeLessThan(order.indexOf('get'));
    expect(order.indexOf('coverage')).toBeLessThan(order.indexOf('get'));
    for (const fixed of ['export', 'recomputeOwners', 'purge']) {
      expect(order.indexOf(fixed)).toBeLessThan(order.indexOf('setStatus'));
    }
  });

  it('keeps every Sales capability away from list, coverage, export-class and reassign routes', () => {
    // Sales Depot = Work only: it must not reach the Read-class routes or any other class.
    const workOnly = Object.entries(ROUTES).filter(([, cap]) => cap === 'b2bProspectWork').map(([r]) => r);
    expect(workOnly.sort()).toEqual(['convert', 'get', 'mine', 'setStatus', 'suppressProspect', 'visit']);
    // export and recompute are never a Work route
    expect(ROUTES['export']).toBe('b2bProspectExport');
    expect(CAPABILITIES.b2bProspectExport).not.toContain('C_sales');
    expect(CAPABILITIES.b2bProspectWork).not.toContain('DIREKTUR');
    expect(can('b2bProspectRead', 'STAFF_DEPOT')).toBe(false);
  });

  it('delegates each handler to its service with the caller', async () => {
    prospects.list.mockResolvedValue('L');
    prospects.mine.mockResolvedValue('M');
    prospects.coverage.mockResolvedValue('C');
    prospects.get.mockResolvedValue('G');
    prospects.suppress.mockResolvedValue('S');
    prospects.setStatus.mockResolvedValue('ST');
    prospects.assign.mockResolvedValue('A');
    prospects.setOwnerDepot.mockResolvedValue('O');
    prospects.suppressProspect.mockResolvedValue('SP');
    intake.createField.mockResolvedValue('CR');
    intake.importFile.mockResolvedValue('IM');

    expect(await c.list(user, { scope: 'map' } as never)).toBe('L');
    expect(prospects.list).toHaveBeenCalledWith(user, { scope: 'map' });
    expect(await c.mine(user, {} as never)).toBe('M');
    expect(await c.coverage(user, { depotId: 'd1' })).toBe('C');
    expect(prospects.coverage).toHaveBeenCalledWith(user, 'd1');
    expect(await c.get(user, 'p1')).toBe('G');
    expect(await c.suppress(user, { reason: 'OTHER' } as never)).toBe('S');
    expect(await c.setStatus(user, 'p1', { status: 'LOST' } as never)).toBe('ST');
    expect(await c.assign(user, 'p1', { assigneeId: null, seenUpdatedAt: '2026-11-27T01:00:00.000Z' })).toBe('A');
    expect(prospects.assign).toHaveBeenCalledWith(user, 'p1', null, '2026-11-27T01:00:00.000Z');
    prospects.assignees.mockResolvedValue('AS');
    expect(await c.assignees(user, { depotId: 'd1' })).toBe('AS');
    expect(prospects.assignees).toHaveBeenCalledWith(user, 'd1');
    expect(await c.setOwnerDepot(user, 'p1', { depotId: null, reason: 'abc' })).toBe('O');
    expect(await c.suppressProspect(user, 'p1', { reason: 'OTHER' })).toBe('SP');
    expect(prospects.suppressProspect).toHaveBeenCalledWith(user, 'p1', 'OTHER');
  });

  it('delegates visit, convert, export, recompute and purge', async () => {
    visits.visit.mockResolvedValue('V');
    prospects.convert.mockResolvedValue('CV');
    exporter.export.mockResolvedValue('EX');
    maintenance.recomputeOwners.mockResolvedValue('RC');
    maintenance.purge.mockResolvedValue({ deleted: 1, anonymised: 2 });
    const fix = { latitude: -6.2, longitude: 106.8, accuracyM: 9, outcome: 'NOT_THERE' } as never;
    expect(await c.visit(user, 'p1', fix)).toBe('V');
    expect(visits.visit).toHaveBeenCalledWith(user, 'p1', fix);
    expect(await c.convert(user, 'p1', { customerId: 'c1' })).toBe('CV');
    expect(prospects.convert).toHaveBeenCalledWith(user, 'p1', 'c1');
    expect(await c.export(user, { status: 'NEW' } as never)).toBe('EX');
    expect(exporter.export).toHaveBeenCalledWith(user, { status: 'NEW' });
    expect(await c.recomputeOwners(user)).toBe('RC');
    expect(await c.purge({ cutoff: '2026-06-01T00:00:00.000Z' })).toEqual({ deleted: 1, anonymised: 2 });
    expect(maintenance.purge).toHaveBeenCalledWith(new Date('2026-06-01T00:00:00.000Z'));
  });

  it('turns the field-find latitude/longitude into the intake pin', async () => {
    await c.create(user, { name: 'X', category: 'KOS', latitude: -6.2, longitude: 106.8, phone: '08' } as never);
    expect(intake.createField).toHaveBeenCalledWith(user, { name: 'X', category: 'KOS', phone: '08', lat: -6.2, lng: 106.8 });
  });

  it('passes an import through with cost 0 by default', async () => {
    await c.import(user, { dryRun: true, rows: [{ name: 'a' }] } as never);
    expect(intake.importFile).toHaveBeenCalledWith(user, { dryRun: true, costIdr: 0, rows: [{ name: 'a' }] });
    await c.import(user, { dryRun: false, costIdr: 5, rows: [] } as never);
    expect(intake.importFile).toHaveBeenLastCalledWith(user, { dryRun: false, costIdr: 5, rows: [] });
  });
});

describe('b2b-prospect DTOs', () => {
  const errors = async <T extends object>(cls: new () => T, body: Record<string, unknown>) =>
    (await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

  const goodRow = { name: 'Kos', category: 'kos', lat: -6.2, lng: 106.8, source: 'osm', license: 'ODbL-1.0' };

  it('refuses a 501-row file and an empty one, and needs the dryRun flag', async () => {
    const rows = Array.from({ length: 501 }, () => goodRow);
    expect(await errors(ImportProspectsDto, { dryRun: true, rows })).toContain('rows');
    expect(await errors(ImportProspectsDto, { dryRun: true, rows: [] })).toContain('rows');
    expect(await errors(ImportProspectsDto, { rows: [goodRow] })).toContain('dryRun');
    expect(await errors(ImportProspectsDto, { dryRun: false, rows: rows.slice(0, 500) })).toEqual([]);
    expect(await errors(ImportProspectsDto, { dryRun: false, costIdr: -1, rows: [goodRow] })).toContain('costIdr');
  });

  it('accepts a whole AREA-T candidate row, every column, without a 400', async () => {
    const row = {
      name: 'Kos Melati', category: 'kos', address: 'Jl. A', phone: '0812', lat: '-6.2', lng: '106.8',
      kecamatanCode: '3173010', kelurahanCode: '3173010001', gridCell: '-690:11866', ownerDepotCode: 'HDX01',
      distanceKm: '1.2', source: 'osm', license: 'ODbL-1.0', sourceId: 'node/1', sourceDataset: 'osm',
      sourceUpdated: '2026-11-01', fetchedDate: '2026-11-27', categoryConfidence: '0.9', alsoIn: 'overture:abc',
    };
    expect(await errors(ImportProspectRowDto, row)).toEqual([]);
    const built = plainToInstance(ImportProspectRowDto, row);
    expect(built.lat).toBe(-6.2);
  });

  it('turns blank cells into "not given" and a bad pin into a row failure, not a 400', async () => {
    const built = plainToInstance(ImportProspectRowDto, { name: ' ', phone: '', lat: '', lng: 'abc' });
    expect(built).toMatchObject({ name: undefined, phone: undefined, lat: undefined });
    expect(Number.isNaN(built.lng)).toBe(true);
    expect(await errors(ImportProspectRowDto, { name: ' ', phone: '', lat: '', lng: 'abc' })).toEqual([]);
    expect(plainToInstance(ImportProspectRowDto, { lat: null }).lat).toBeUndefined();
  });

  it('refuses a row field of the wrong type or an unknown column', async () => {
    expect(await errors(ImportProspectRowDto, { name: 5 })).toContain('name');
    expect(await errors(ImportProspectRowDto, { colour: 'red' })).toContain('colour');
  });

  it('requires a real pin and a known category for a field find', async () => {
    const ok = { name: 'Kos', category: 'KOS', latitude: -6.2, longitude: 106.8 };
    expect(await errors(CreateProspectDto, ok)).toEqual([]);
    expect(await errors(CreateProspectDto, { ...ok, category: 'HOTEL' })).toContain('category');
    expect(await errors(CreateProspectDto, { ...ok, latitude: 91 })).toContain('latitude');
    expect(await errors(CreateProspectDto, { ...ok, longitude: undefined })).toContain('longitude');
    expect(await errors(CreateProspectDto, { ...ok, source: 'osm' })).toContain('source');
  });

  it('takes assigned as me, none or a uuid; assignee as a uuid or null; the owner depot likewise', async () => {
    const u = '11111111-1111-4111-8111-111111111111';
    expect(await errors(ProspectListQueryDto, { assigned: 'me' })).toEqual([]);
    expect(await errors(ProspectListQueryDto, { assigned: 'none', limit: '100' })).toEqual([]);
    expect(await errors(ProspectListQueryDto, { assigned: u, scope: 'map' })).toEqual([]);
    expect(await errors(ProspectListQueryDto, { assigned: 'nobody' })).toContain('assigned');
    expect(await errors(ProspectListQueryDto, { limit: '101' })).toContain('limit');
    expect(await errors(AssignProspectDto, { assigneeId: null })).toEqual([]);
    expect(await errors(AssignProspectDto, { assigneeId: u })).toEqual([]);
    expect(await errors(AssignProspectDto, {})).toContain('assigneeId');
    expect(await errors(SetOwnerDepotDto, { depotId: null, reason: 'abc' })).toEqual([]);
    expect(await errors(SetOwnerDepotDto, { depotId: 'x', reason: 'abc' })).toContain('depotId');
    expect(await errors(SetOwnerDepotDto, { depotId: null, reason: 'ab' })).toContain('reason');
    expect(await errors(SetOwnerDepotDto, { depotId: null, reason: 'abc', seenUpdatedAt: '2026-11-27T01:00:00.000Z' })).toEqual([]);
    expect(await errors(SetOwnerDepotDto, { depotId: null, reason: 'abc', seenUpdatedAt: 'yesterday' })).toContain('seenUpdatedAt');
    expect(await errors(AssignProspectDto, { assigneeId: null, seenUpdatedAt: 'yesterday' })).toContain('seenUpdatedAt');
    expect(await errors(AssigneesQueryDto, { depotId: u })).toEqual([]);
    expect(await errors(AssigneesQueryDto, {})).toContain('depotId');
  });

  it('needs a stated, finite, non-negative accuracy and a known outcome for a check-in', async () => {
    const ok = { latitude: -6.2, longitude: 106.8, accuracyM: 12, outcome: 'REFUSED' };
    expect(await errors(VisitProspectDto, ok)).toEqual([]);
    expect(await errors(VisitProspectDto, { ...ok, note: 'x'.repeat(500) })).toEqual([]);
    expect(await errors(VisitProspectDto, { ...ok, accuracyM: undefined })).toContain('accuracyM');
    expect(await errors(VisitProspectDto, { ...ok, accuracyM: -1 })).toContain('accuracyM');
    expect(await errors(VisitProspectDto, { ...ok, accuracyM: 2 ** 31 })).toContain('accuracyM');
    expect(await errors(VisitProspectDto, { ...ok, latitude: 95 })).toContain('latitude');
    expect(await errors(VisitProspectDto, { ...ok, outcome: 'SOLD' })).toContain('outcome');
    expect(await errors(VisitProspectDto, { ...ok, note: 'x'.repeat(501) })).toContain('note');
  });

  it('takes an optional customer uuid to convert, the export filters, and an ISO cutoff to purge', async () => {
    const u = '11111111-1111-4111-8111-111111111111';
    expect(await errors(ConvertProspectDto, {})).toEqual([]);
    expect(await errors(ConvertProspectDto, { customerId: u })).toEqual([]);
    expect(await errors(ConvertProspectDto, { customerId: 'x' })).toContain('customerId');
    expect(await errors(ExportProspectsDto, {})).toEqual([]);
    expect(await errors(ExportProspectsDto, { depotId: u, status: 'NEW', category: 'KOS', kecamatanCode: 'K', assigned: 'me' })).toEqual([]);
    expect(await errors(ExportProspectsDto, { assigned: u })).toEqual([]);
    expect(await errors(ExportProspectsDto, { assigned: 'nobody' })).toContain('assigned');
    expect(await errors(ExportProspectsDto, { status: 'GONE' })).toContain('status');
    expect(await errors(PurgeProspectsDto, { cutoff: '2026-06-01T00:00:00.000Z' })).toEqual([]);
    expect(await errors(PurgeProspectsDto, { cutoff: 'yesterday' })).toContain('cutoff');
    expect(await errors(PurgeProspectsDto, {})).toContain('cutoff');
  });

  it('takes a do-not-contact reason from the closed list only', async () => {
    expect(await errors(SuppressDto, { phone: '0812', reason: 'LEGAL' })).toEqual([]);
    expect(await errors(SuppressDto, { phone: '0812', reason: 'BORED' })).toContain('reason');
    expect(plainToInstance(SuppressDto, { phone: '  ', reason: 'LEGAL' }).phone).toBeUndefined();
  });
});
