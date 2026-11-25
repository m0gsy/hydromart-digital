import { BadRequestException, ConflictException, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser, CAPABILITY_KEY } from '@hydromart/platform';

import { SopRepository, SopVersionWithDepots, SopVersionWrite, SopWithVersions } from '../../src/application/ports/sop.repository';
import { MAX_SOP_PDF_BYTES, SopService } from '../../src/application/services/sop.service';
import { audienceTargets, coversDepot, currentVersion, dayKeyOf, inForce } from '../../src/domain/sop';
import { SopPrismaRepository } from '../../src/infrastructure/prisma/sop.prisma.repository';
import { CreateSopDto, InForceQueryDto, SopVersionDto, UnreadSopDto } from '../../src/modules/dto/sop.dto';
import { SopController } from '../../src/modules/sop.controller';

const D1 = '00000000-0000-4000-8000-000000000001';
const D2 = '00000000-0000-4000-8000-000000000002';
const D3 = '00000000-0000-4000-8000-000000000003';
const SOP1 = '00000000-0000-4000-8000-0000000000a1';
const SOP2 = '00000000-0000-4000-8000-0000000000a2';
const FILE_KEY = 'hr/sop/00000000-0000-4000-8000-0000000000f1.pdf';

const head: AuthenticatedUser = { sub: 'ho-1', role: 'HEAD_OFFICE' as never, phone: null, depotId: null };
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: null, depotId: null };
const kepala: AuthenticatedUser = { sub: 'kd-1', role: 'KEPALA_DEPOT' as never, phone: null, depotId: D1 };

// WIB 2026-11-28 03:00 is still 2026-11-27 in UTC: the day a UTC cut would get wrong.
const NOW = new Date('2026-11-27T20:00:00.000Z');
const TODAY = '2026-11-28';

describe('domain/sop', () => {
  const v = (versionNo: number, effectiveFrom: string, allDepots: boolean, depotIds: string[] = []) => ({
    versionNo,
    effectiveFrom,
    allDepots,
    depotIds,
  });

  it('reads a @db.Date as its own calendar day', () => {
    expect(dayKeyOf(new Date('2026-11-28T00:00:00.000Z'))).toBe('2026-11-28');
  });

  it('covers a depot when the version names it or names everyone', () => {
    expect(coversDepot(v(1, TODAY, true), D1)).toBe(true);
    expect(coversDepot(v(1, TODAY, false, [D1]), D1)).toBe(true);
    expect(coversDepot(v(1, TODAY, false, [D2]), D1)).toBe(false);
  });

  it('puts a version in force on its effective day, not before', () => {
    expect(inForce([v(1, TODAY, true)], D1, TODAY)?.versionNo).toBe(1);
    expect(inForce([v(1, '2026-11-29', true)], D1, TODAY)).toBeNull();
  });

  it('lets the highest number that has taken effect and covers the depot win', () => {
    const versions = [v(1, '2026-01-01', true), v(2, '2026-06-01', false, [D2]), v(3, '2027-01-01', true)];
    expect(inForce(versions, D1, TODAY)?.versionNo).toBe(1); // v2 names another depot
    expect(inForce(versions, D2, TODAY)?.versionNo).toBe(2);
    expect(inForce([...versions].reverse(), D2, TODAY)?.versionNo).toBe(2); // order does not matter
    expect(inForce([v(1, '2026-01-01', false, [D2])], D1, TODAY)).toBeNull();
  });

  it('names the newest version in effect anywhere', () => {
    expect(currentVersion([v(1, '2026-01-01', true), v(2, '2026-02-01', false, [D2]), v(3, '2027-01-01', true)], TODAY)?.versionNo).toBe(2);
    expect(currentVersion([v(1, '2027-01-01', true)], TODAY)).toBeNull();
    expect(currentVersion([v(2, '2026-02-01', true), v(1, '2026-01-01', true)], TODAY)?.versionNo).toBe(2);
  });

  it('turns a version into audience targets', () => {
    expect(audienceTargets({ allDepots: true, depotIds: [] })).toEqual([{ dimension: 'COMPANY', value: null }]);
    expect(audienceTargets({ allDepots: false, depotIds: [D1, D2] })).toEqual([
      { dimension: 'DEPOT', value: D1 },
      { dimension: 'DEPOT', value: D2 },
    ]);
  });
});

// ── service ───────────────────────────────────────────────────────────

const staff = (id: string, depotId: string | null, over: Record<string, unknown> = {}) => ({
  id,
  employeeCode: `HR-${id}`,
  fullName: `Nama ${id}`,
  position: 'Staff',
  depotId,
  homeDepotId: null,
  departmentId: null,
  ...over,
});

class FakeRepo implements SopRepository {
  sops: SopWithVersions[] = [];
  acks = new Map<string, string[]>();
  failAdd: unknown[] = [];
  addReturnsNull = false;
  private seq = 0;

  private build(versionNo: number, w: SopVersionWrite, sopId: string): SopVersionWithDepots {
    const { depotIds, ...rest } = w;
    return {
      id: `ver-${++this.seq}`,
      sopId,
      versionNo,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      ...rest,
      depots: depotIds.map((depotId) => ({ depotId })),
    } as unknown as SopVersionWithDepots;
  }

  async create(title: string, createdBy: string | null, w: SopVersionWrite): Promise<SopWithVersions> {
    const sop = { id: `sop-${++this.seq}`, title, createdBy, createdAt: new Date('2026-11-01T00:00:00.000Z'), versions: [] } as unknown as SopWithVersions;
    sop.versions.push(this.build(1, w, sop.id));
    this.sops.push(sop);
    return sop;
  }
  async addVersion(sopId: string, w: SopVersionWrite): Promise<SopVersionWithDepots | null> {
    const failure = this.failAdd.shift();
    if (failure) throw failure;
    const sop = this.sops.find((s) => s.id === sopId);
    if (!sop || this.addReturnsNull) return null;
    const row = this.build(sop.versions.length + 1, w, sopId);
    sop.versions.unshift(row);
    return row;
  }
  async findById(id: string) {
    return this.sops.find((s) => s.id === id) ?? null;
  }
  async list() {
    return this.sops;
  }
  async findVersion(versionId: string) {
    for (const sop of this.sops) {
      const version = sop.versions.find((x) => x.id === versionId);
      if (version) return { ...version, sop } as never;
    }
    return null;
  }
  async listVersions(sopIds: readonly string[]) {
    return this.sops.filter((s) => sopIds.includes(s.id)).flatMap((s) => s.versions.map((x) => ({ ...x, sop: s }))) as never;
  }
  async countAcks(versionIds: readonly string[]) {
    return new Map(versionIds.filter((id) => this.acks.has(id)).map((id) => [id, this.acks.get(id)!.length]));
  }
  async listAckedEmployeeIds(versionId: string) {
    return this.acks.get(versionId) ?? [];
  }
}

const PDF = Buffer.from('%PDF-1.4\n%fake\n');

describe('SopService', () => {
  let repo: FakeRepo;
  let employees: { list: jest.Mock };
  let storage: { put: jest.Mock; getObject: jest.Mock; remove: jest.Mock };
  let service: SopService;
  let warn: jest.SpyInstance;
  let roster: ReturnType<typeof staff>[];

  const input = (over: Record<string, unknown> = {}) => ({
    body: 'Cuci tangan sebelum mengisi galon.',
    effectiveFrom: TODAY,
    allDepots: true,
    ...over,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    repo = new FakeRepo();
    roster = [staff('e1', D1), staff('e2', D1), staff('e3', D2), staff('e4', null), staff('e5', D3, { homeDepotId: D1 })];
    employees = { list: jest.fn(async () => ({ rows: roster, total: roster.length })) };
    storage = {
      put: jest.fn(async () => ({ url: 'https://files/x', key: FILE_KEY })),
      getObject: jest.fn(),
      remove: jest.fn(),
    };
    service = new SopService(repo, employees as never, storage as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('upload', () => {
    it('refuses a missing file, a non-PDF whatever it is called, and an oversized one', async () => {
      await expect(service.upload(undefined)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.upload({ buffer: Buffer.from('<html>pdf</html>'), size: 20 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.upload({ buffer: PDF, size: MAX_SOP_PDF_BYTES + 1 })).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('stores a PDF under hr/sop and returns its key', async () => {
      await expect(service.upload({ buffer: PDF, size: 15, originalname: 'sop-galon.pdf' })).resolves.toEqual({
        fileKey: FILE_KEY,
        fileName: 'sop-galon.pdf',
        sizeBytes: 15,
      });
      expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ keyPrefix: 'hr/sop', ext: 'pdf', contentType: 'application/pdf' }));
      expect((await service.upload({ buffer: PDF, size: 15 })).fileName).toBe('sop.pdf');
    });

    it('answers 503 when storage is down or not configured', async () => {
      storage.put.mockRejectedValueOnce(new Error('s3 down'));
      await expect(service.upload({ buffer: PDF, size: 15 })).rejects.toBeInstanceOf(ServiceUnavailableException);
      storage.put.mockResolvedValueOnce({ url: '', key: '' });
      await expect(service.upload({ buffer: PDF, size: 15 })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('create and addVersion', () => {
    it('creates a SOP with version 1 and freezes the audience', async () => {
      const out = await service.create(head, 'SOP isi ulang galon', input());
      expect(out.title).toBe('SOP isi ulang galon');
      expect(out.versions).toHaveLength(1);
      expect(out.versions[0]).toMatchObject({
        versionNo: 1,
        title: 'SOP isi ulang galon',
        effectiveFrom: TODAY,
        allDepots: true,
        audienceSize: 5,
        ackCount: 0,
        unread: 5,
        hasFile: false,
        fileName: null,
        sizeBytes: null,
        body: 'Cuci tangan sebelum mengisi galon.',
      });
      expect(repo.sops[0].createdBy).toBe('ho-1');
    });

    it('counts a depot audience once per person, lent staff included', async () => {
      const out = await service.create(head, 'SOP depot', input({ allDepots: false, depotIds: [D1, D1, D2], versionTitle: ' Versi depot ' }));
      // e1, e2 at D1, e3 at D2, e5 lent to D3 but belongs to D1; e4 sits above depots.
      expect(out.versions[0]).toMatchObject({ audienceSize: 4, depotIds: [D1, D2], title: 'Versi depot' });
    });

    it('keeps a PDF the upload route minted, with a default name', async () => {
      const withFile = await service.create(head, 'SOP pdf', input({ body: '   ', fileKey: FILE_KEY, sizeBytes: 15 }));
      expect(withFile.versions[0]).toMatchObject({ hasFile: true, fileName: 'sop.pdf', sizeBytes: 15, body: null });
      const named = await service.create(head, 'SOP pdf 2', input({ fileKey: FILE_KEY, fileName: 'a.pdf' }));
      expect(named.versions[0]).toMatchObject({ fileName: 'a.pdf', sizeBytes: null });
    });

    it.each([
      ['both everyone and a list', { allDepots: true, depotIds: [D1] }],
      ['neither', { allDepots: false }],
      ['an empty list', { allDepots: false, depotIds: [] }],
      ['a date that is not real', { effectiveFrom: '2026-02-31' }],
      ['a date that cannot parse', { effectiveFrom: '2026-13-45' }],
      ['yesterday (WIB), which is today in UTC', { effectiveFrom: '2026-11-27' }],
      ['no text and no file', { body: '  ' }],
      ['a file key from another folder', { fileKey: 'hr/documents/00000000-0000-4000-8000-0000000000f1.pdf' }],
      ['a file key made of 36 dashes', { fileKey: `hr/sop/${'-'.repeat(36)}.pdf` }],
      ['a file key that is not a pdf', { fileKey: 'hr/sop/00000000-0000-4000-8000-0000000000f1.png' }],
    ])('refuses %s', async (_name, over) => {
      await expect(service.create(head, 'SOP', input(over))).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.sops).toHaveLength(0);
    });

    it('accepts today and a future day, and stops reading a roster that never ends', async () => {
      await expect(service.create(head, 'SOP', input({ effectiveFrom: '2027-01-01' }))).resolves.toBeDefined();
      employees.list.mockResolvedValue({ rows: roster, total: 9999 });
      await service.create(head, 'SOP', input());
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('roster not fully read'));
      expect(employees.list).toHaveBeenCalledTimes(101);
    });

    it('reads the whole roster page by page, so a large audience is counted in full', async () => {
      const big = Array.from({ length: 2500 }, (_, i) => staff(`b${i}`, D1));
      employees.list.mockImplementation(async ({ skip, take }: { skip: number; take: number }) => ({ rows: big.slice(skip, skip + take), total: big.length }));
      const out = await service.create(head, 'SOP besar', input());
      expect(out.versions[0].audienceSize).toBe(2500);
      expect(employees.list).toHaveBeenCalledTimes(3);
      employees.list.mockResolvedValue({ rows: [], total: 5 });
      expect((await service.create(head, 'SOP kosong', input())).versions[0].audienceSize).toBe(0);
    });

    it('refuses a depot id that depot-service does not know, and passes a 503 on', async () => {
      const isActive = jest.fn(async (id: string) => {
        if (id === D2) throw new NotFoundException('x');
        if (id === D3) throw new ServiceUnavailableException('down');
        return true;
      });
      const checked = new SopService(repo, employees as never, storage as never, { isActive } as never);
      await expect(checked.create(head, 'SOP', input({ allDepots: false, depotIds: [D1, D2] }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(checked.create(head, 'SOP', input({ allDepots: false, depotIds: [D1, D3] }))).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(checked.create(head, 'SOP', input({ allDepots: false, depotIds: [D1] }))).resolves.toBeDefined();
      await expect(checked.create(head, 'SOP', input())).resolves.toBeDefined(); // everyone: nothing to look up
      expect(repo.sops).toHaveLength(2);
    });

    it('adds version n+1 and leaves the old one untouched', async () => {
      const first = await service.create(head, 'SOP isi ulang', input());
      const out = await service.addVersion(head, first.id, input({ body: 'Revisi', versionTitle: 'Revisi November' }));
      expect(out.versions.map((x) => x.versionNo)).toEqual([2, 1]);
      expect(out.versions[0]).toMatchObject({ title: 'Revisi November', body: 'Revisi' });
      expect(out.versions[1].body).toBe('Cuci tangan sebelum mengisi galon.');
      const plain = await service.addVersion(head, first.id, input({ body: 'Revisi 2' }));
      expect(plain.versions[0].title).toBe('SOP isi ulang');
    });

    it('404s an unknown SOP, whether the lookup or the write finds it missing', async () => {
      await expect(service.addVersion(head, SOP1, input())).rejects.toBeInstanceOf(NotFoundException);
      const sop = await service.create(head, 'SOP', input());
      repo.addReturnsNull = true;
      await expect(service.addVersion(head, sop.id, input())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retries once when two writers race for the same number, then gives up with 409', async () => {
      const sop = await service.create(head, 'SOP', input());
      const clash = { code: 'P2002' };
      repo.failAdd = [clash];
      await expect(service.addVersion(head, sop.id, input())).resolves.toBeDefined();
      repo.failAdd = [clash, clash];
      await expect(service.addVersion(head, sop.id, input())).rejects.toBeInstanceOf(ConflictException);
      repo.failAdd = [new Error('db down')];
      await expect(service.addVersion(head, sop.id, input())).rejects.toThrow('db down');
    });
  });

  describe('reading', () => {
    it('lists each SOP with its current and upcoming version and the ack counts', async () => {
      const a = await service.create(head, 'SOP A', input({ effectiveFrom: TODAY }));
      repo.acks.set(a.versions[0].id, ['e1', 'e2']);
      await service.addVersion(head, a.id, input({ effectiveFrom: '2027-02-01' }));
      await service.addVersion(head, a.id, input({ effectiveFrom: '2027-03-01' })); // two upcoming: the newest number is shown
      await service.create(head, 'SOP B', input({ effectiveFrom: '2027-03-01' }));
      // A third SOP whose only version is old: no upcoming.
      repo.sops.push({ ...repo.sops[0], id: 'sop-old', versions: [{ ...repo.sops[0].versions[0], id: 'ver-old', effectiveFrom: new Date('2026-01-01T00:00:00.000Z') }] } as never);
      const list = await service.list();
      expect(list).toHaveLength(3);
      expect(list[0]).toMatchObject({ title: 'SOP A', versionCount: 3 });
      expect(list[0].current).toMatchObject({ versionNo: 1, ackCount: 2, unread: 3, audienceSize: 5 });
      expect(list[0].upcoming).toMatchObject({ versionNo: 3, effectiveFrom: '2027-03-01', ackCount: 0 });
      expect(list[1]).toMatchObject({ current: null, upcoming: { versionNo: 1 } });
      expect(list[2]).toMatchObject({ current: { id: 'ver-old', ackCount: 0 }, upcoming: null });
    });

    it('never shows a negative unread count when more acked than the frozen audience', async () => {
      const a = await service.create(head, 'SOP A', input());
      repo.acks.set(a.versions[0].id, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
      expect((await service.list())[0].current?.unread).toBe(0);
    });

    it('returns one SOP with its history, or 404', async () => {
      const a = await service.create(head, 'SOP A', input());
      expect((await service.getById(a.id)).versions).toHaveLength(1);
      await expect(service.getById(SOP2)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unread', () => {
    it('is the audience minus the acks, counted per depot', async () => {
      const a = await service.create(head, 'SOP A', input());
      const versionId = a.versions[0].id;
      repo.acks.set(versionId, ['e1']);
      const page = await service.unread(hr, versionId, {});
      expect(page).toMatchObject({ versionId, versionNo: 1, audienceSize: 5, ackCount: 1, unreadTotal: 4, page: 1, pageSize: 50 });
      expect(page.items.map((i) => i.employeeId)).toEqual(['e2', 'e3', 'e4', 'e5']);
      expect(page.items[0]).toEqual({ employeeId: 'e2', employeeCode: 'HR-e2', fullName: 'Nama e2', position: 'Staff', depotId: D1 });
      expect(page.byDepot).toEqual(expect.arrayContaining([{ depotId: D1, unread: 1 }, { depotId: D2, unread: 1 }, { depotId: null, unread: 1 }, { depotId: D3, unread: 1 }]));
    });

    it('narrows to one depot when asked, and pages', async () => {
      const a = await service.create(head, 'SOP A', input());
      const versionId = a.versions[0].id;
      const one = await service.unread(hr, versionId, { depotId: D1 });
      expect(one.items.map((i) => i.employeeId)).toEqual(['e1', 'e2']);
      const paged = await service.unread(hr, versionId, { page: 2, pageSize: 2 });
      expect(paged).toMatchObject({ page: 2, pageSize: 2, unreadTotal: 5 });
      expect(paged.items.map((i) => i.employeeId)).toEqual(['e3', 'e4']);
    });

    it('keeps a depot-bound reader to their own depot, and drops people above depots', async () => {
      const a = await service.create(head, 'SOP A', input());
      const page = await service.unread(kepala, a.versions[0].id, {});
      expect(page.items.map((i) => i.employeeId)).toEqual(['e1', 'e2']);
    });

    it('only chases people the version actually reaches', async () => {
      const a = await service.create(head, 'SOP depot', input({ allDepots: false, depotIds: [D2] }));
      const page = await service.unread(hr, a.versions[0].id, {});
      expect(page.items.map((i) => i.employeeId)).toEqual(['e3']);
    });

    it('404s an unknown version', async () => {
      await expect(service.unread(hr, SOP1, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('counts only acks of audience members the caller may see, so the numbers reconcile', async () => {
      const a = await service.create(head, 'SOP A', input());
      repo.acks.set(a.versions[0].id, ['e1', 'e3', 'gone']); // e3 is another depot, gone has left
      const page = await service.unread(kepala, a.versions[0].id, {});
      expect(page).toMatchObject({ ackCount: 1, unreadTotal: 1 });
      const all = await service.unread(hr, a.versions[0].id, {});
      expect(all).toMatchObject({ ackCount: 2, unreadTotal: 3 });
    });
  });

  describe('inForceFor', () => {
    it('answers the version in force for a depot, per SOP, by the WIB day', async () => {
      const all = await service.create(head, 'SOP umum', input({ effectiveFrom: TODAY }));
      const onlyD2 = await service.create(head, 'SOP khusus', input({ allDepots: false, depotIds: [D2] }));
      await service.addVersion(head, all.id, input({ body: 'v2', effectiveFrom: '2026-11-29' }));
      const out = await service.inForceFor(D1, [all.id, onlyD2.id, SOP2]);
      expect(out.items).toEqual([{ sopId: all.id, versionId: all.versions[0].id, versionNo: 1, title: 'SOP umum', effectiveFrom: TODAY }]);
      // An hour earlier it is still the 27th in WIB: nothing in force yet.
      expect((await service.inForceFor(D1, [all.id], new Date('2026-11-27T16:59:00.000Z'))).items).toEqual([]);
      // Two days on, version 2 binds the depot.
      expect((await service.inForceFor(D1, [all.id], new Date('2026-11-29T05:00:00.000Z'))).items[0].versionNo).toBe(2);
    });
  });
});

// ── controller ────────────────────────────────────────────────────────

describe('SopController', () => {
  it('delegates every route to the service', () => {
    const svc = {
      upload: jest.fn(),
      create: jest.fn(),
      addVersion: jest.fn(),
      list: jest.fn(),
      inForceFor: jest.fn(),
      unread: jest.fn(),
      getById: jest.fn(),
    };
    const c = new SopController(svc as never);
    const file = { buffer: PDF, size: 15 };
    c.upload(file);
    expect(svc.upload).toHaveBeenCalledWith(file);
    const dto = { title: 'SOP', effectiveFrom: TODAY, allDepots: true } as never;
    c.create(dto, head);
    expect(svc.create).toHaveBeenCalledWith(head, 'SOP', dto);
    c.addVersion(SOP1, dto, head);
    expect(svc.addVersion).toHaveBeenCalledWith(head, SOP1, dto);
    c.list();
    expect(svc.list).toHaveBeenCalled();
    c.inForce({ depotId: D1, ids: [SOP1] });
    expect(svc.inForceFor).toHaveBeenCalledWith(D1, [SOP1]);
    const q = { depotId: D1, page: 2 };
    c.unread(SOP1, q, hr);
    expect(svc.unread).toHaveBeenCalledWith(hr, SOP1, q);
    c.getById(SOP1);
    expect(svc.getById).toHaveBeenCalledWith(SOP1);
  });

  it('guards the writes with sopManage, the reads with sopRead, and the lookup with the internal key', () => {
    const cap = (name: keyof SopController) =>
      (Reflect.getMetadata(CAPABILITY_KEY, SopController.prototype[name] as never) as string | undefined) ?? null;
    expect(cap('upload')).toBe('sopManage');
    expect(cap('create')).toBe('sopManage');
    expect(cap('addVersion')).toBe('sopManage');
    expect(cap('list')).toBe('sopRead');
    expect(cap('unread')).toBe('sopRead');
    expect(cap('getById')).toBe('sopRead');
    expect(cap('inForce')).toBeNull();
    const guards = Reflect.getMetadata('__guards__', SopController.prototype.inForce) as { name: string }[];
    expect(guards.map((g) => g.name)).toContain('InternalAuthGuard');
  });
});

// ── dto ───────────────────────────────────────────────────────────────

describe('SOP DTOs', () => {
  const ok = { title: 'SOP isi ulang', effectiveFrom: TODAY, allDepots: false, depotIds: [D1], body: 'x' };
  const errors = async (cls: new () => object, plain: object) => (await validate(plainToInstance(cls, plain))).map((e) => e.property);

  it('accepts a well-formed version and refuses malformed fields', async () => {
    expect(await errors(CreateSopDto, ok)).toEqual([]);
    expect(await errors(CreateSopDto, { ...ok, title: 'ab' })).toEqual(['title']);
    expect(await errors(CreateSopDto, { ...ok, effectiveFrom: '28-11-2026' })).toEqual(['effectiveFrom']);
    expect(await errors(CreateSopDto, { ...ok, depotIds: ['nope'] })).toEqual(['depotIds']);
    expect(await errors(CreateSopDto, { ...ok, allDepots: 'yes' })).toEqual(['allDepots']);
    expect(await errors(CreateSopDto, { ...ok, depotIds: Array(201).fill(D1) })).toEqual(['depotIds']);
    expect(await errors(CreateSopDto, { ...ok, body: 'x'.repeat(50_001) })).toEqual(['body']);
    expect(await errors(SopVersionDto, { effectiveFrom: TODAY, allDepots: true, versionTitle: 'ab' })).toEqual(['versionTitle']);
    expect(await errors(SopVersionDto, { effectiveFrom: TODAY, allDepots: true, sizeBytes: -1, fileKey: FILE_KEY, fileName: 'a.pdf' })).toEqual(['sizeBytes']);
  });

  it('reads paging as integers and the in-force ids as a comma list', async () => {
    expect(plainToInstance(UnreadSopDto, { page: '2', pageSize: '30', depotId: D1 })).toMatchObject({ page: 2, pageSize: 30 });
    expect(await errors(UnreadSopDto, { pageSize: '101' })).toEqual(['pageSize']);
    const parsed = plainToInstance(InForceQueryDto, { depotId: D1, ids: `${SOP1}, ${SOP2},` });
    expect(parsed.ids).toEqual([SOP1, SOP2]);
    expect(await validate(parsed)).toEqual([]);
    expect(await errors(InForceQueryDto, { depotId: D1, ids: '' })).toEqual(['ids']);
    expect(await errors(InForceQueryDto, { depotId: D1, ids: 'x' })).toEqual(['ids']);
    expect(await errors(InForceQueryDto, { depotId: D1, ids: Array(61).fill(SOP1).join(',') })).toEqual(['ids']);
    expect(plainToInstance(InForceQueryDto, { depotId: D1, ids: [SOP1] }).ids).toEqual([SOP1]);
  });
});

// ── repository ────────────────────────────────────────────────────────

describe('SopPrismaRepository', () => {
  const write: SopVersionWrite = {
    title: 'SOP',
    body: 'x',
    fileKey: null,
    fileName: null,
    sizeBytes: null,
    effectiveFrom: new Date('2026-11-28T00:00:00.000Z'),
    allDepots: false,
    depotIds: [D1, D2],
    audienceSize: 3,
    publishedBy: 'ho-1',
  };
  const depots = { depots: { select: { depotId: true } } };

  function prisma() {
    const p = {
      sop: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      sopVersion: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
      sopAck: { groupBy: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    p.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(p));
    return p;
  }

  it('creates the SOP, version 1 and its depots in one nested write', async () => {
    const p = prisma();
    const out = { id: 's1' };
    p.sop.create.mockResolvedValue(out);
    await expect(new SopPrismaRepository(p as never).create('SOP', 'ho-1', write)).resolves.toBe(out);
    const { depotIds, ...rest } = write;
    expect(p.sop.create).toHaveBeenCalledWith({
      data: { title: 'SOP', createdBy: 'ho-1', versions: { create: { versionNo: 1, ...rest, depots: { create: depotIds.map((depotId) => ({ depotId })) } } } },
      include: { versions: { include: depots, orderBy: { versionNo: 'desc' } } },
    });
  });

  it('numbers a new version max + 1 inside one transaction, from 1 when there is none', async () => {
    const p = prisma();
    const repo = new SopPrismaRepository(p as never);
    p.sop.findUnique.mockResolvedValue({ id: 's1' });
    p.sopVersion.aggregate.mockResolvedValue({ _max: { versionNo: 4 } });
    p.sopVersion.create.mockResolvedValue({ id: 'v5' });
    await expect(repo.addVersion('s1', write)).resolves.toEqual({ id: 'v5' });
    expect(p.sopVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sopId: 's1', versionNo: 5 }) }));
    p.sopVersion.aggregate.mockResolvedValue({ _max: { versionNo: null } });
    await repo.addVersion('s1', write);
    expect(p.sopVersion.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ versionNo: 1 }) }));
    p.sop.findUnique.mockResolvedValue(null);
    await expect(repo.addVersion('s1', write)).resolves.toBeNull();
  });

  it('reads SOPs and versions with their depots', async () => {
    const p = prisma();
    const repo = new SopPrismaRepository(p as never);
    p.sop.findUnique.mockResolvedValue(null);
    p.sop.findMany.mockResolvedValue([]);
    p.sopVersion.findUnique.mockResolvedValue(null);
    p.sopVersion.findMany.mockResolvedValue([]);
    await repo.findById('s1');
    expect(p.sop.findUnique).toHaveBeenCalledWith({ where: { id: 's1' }, include: { versions: { include: depots, orderBy: { versionNo: 'desc' } } } });
    await repo.list();
    expect(p.sop.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, include: { versions: { select: { id: true, sopId: true, versionNo: true, title: true, fileKey: true, fileName: true, sizeBytes: true, effectiveFrom: true, allDepots: true, audienceSize: true, publishedBy: true, createdAt: true, depots: { select: { depotId: true } } }, orderBy: { versionNo: 'desc' } } } });
    await repo.findVersion('v1');
    expect(p.sopVersion.findUnique).toHaveBeenCalledWith({ where: { id: 'v1' }, include: { ...depots, sop: true } });
    await repo.listVersions([SOP1]);
    expect(p.sopVersion.findMany).toHaveBeenCalledWith({ where: { sopId: { in: [SOP1] } }, include: { ...depots, sop: true }, orderBy: { versionNo: 'desc' } });
  });

  it('counts acknowledgements per version and lists who acknowledged', async () => {
    const p = prisma();
    const repo = new SopPrismaRepository(p as never);
    await expect(repo.countAcks([])).resolves.toEqual(new Map());
    expect(p.sopAck.groupBy).not.toHaveBeenCalled();
    p.sopAck.groupBy.mockResolvedValue([{ versionId: 'v1', _count: { _all: 3 } }]);
    await expect(repo.countAcks(['v1', 'v2'])).resolves.toEqual(new Map([['v1', 3]]));
    p.sopAck.findMany.mockResolvedValue([{ employeeId: 'e1' }, { employeeId: 'e2' }]);
    await expect(repo.listAckedEmployeeIds('v1')).resolves.toEqual(['e1', 'e2']);
    expect(p.sopAck.findMany).toHaveBeenCalledWith({ where: { versionId: 'v1' }, select: { employeeId: true } });
  });
});
