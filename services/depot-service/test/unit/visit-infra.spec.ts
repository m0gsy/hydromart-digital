const send = jest.fn().mockResolvedValue({});
const getSignedUrl = jest.fn().mockResolvedValue('https://signed.example/visits/k?X-Amz-Expires=300');
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'get', input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: (...a: unknown[]) => getSignedUrl(...a) }));

import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';

import { DepotConfigService } from '../../src/config/depot-config.service';
import { VisitAlreadyOpenError } from '../../src/domain/errors';
import { FollowUpStatus, VisitItemResult, VisitStatus } from '../../src/domain/visit';
import { VisitPrismaRepository } from '../../src/infrastructure/prisma/visit.prisma.repository';
import { VisitLocalStorageAdapter } from '../../src/infrastructure/storage/visit-local-storage.adapter';
import { VisitS3StorageAdapter } from '../../src/infrastructure/storage/visit-s3-storage.adapter';
import { MulterExceptionFilter } from '../../src/modules/multer-exception.filter';

const V = '00000000-0000-4000-8000-0000000000b1';
const DEPOT = '00000000-0000-4000-8000-0000000000d1';
const ITEM = '00000000-0000-4000-8000-0000000000e1';
const ME = '00000000-0000-4000-8000-000000000001';

describe('VisitS3StorageAdapter', () => {
  const config = {
    visitS3: {
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'jkt-1',
      bucket: 'hydromart-pod',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
  } as unknown as DepotConfigService;

  beforeEach(() => jest.clearAllMocks());

  it('puts under visits/<visitId>/<uuid>.<ext> in the private bucket and returns only the key', async () => {
    const body = Buffer.from('bytes');
    const adapter = new VisitS3StorageAdapter(config);
    const { key } = await adapter.put({ visitId: V, body, contentType: 'image/webp', ext: 'webp' });

    expect(key).toMatch(new RegExp(`^visits/${V}/[0-9a-f-]{36}\\.webp$`));
    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://nos.jkt-1.neo.id', forcePathStyle: true }));
    expect(PutObjectCommand).toHaveBeenCalledWith({ Bucket: 'hydromart-pod', Key: key, Body: body, ContentType: 'image/webp' });
    expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('mints a signed read link for the key, expiring as asked, and removes by key', async () => {
    const adapter = new VisitS3StorageAdapter(config);
    await expect(adapter.signedUrl(`visits/${V}/a.jpg`, 300)).resolves.toContain('signed.example');
    expect(getSignedUrl.mock.calls[0][1]).toEqual({ kind: 'get', input: { Bucket: 'hydromart-pod', Key: `visits/${V}/a.jpg` } });
    expect(getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 300 });

    await adapter.remove(`visits/${V}/a.jpg`);
    expect(send.mock.calls[0][0]).toEqual({ kind: 'delete', input: { Bucket: 'hydromart-pod', Key: `visits/${V}/a.jpg` } });
    expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });
});

describe('VisitLocalStorageAdapter', () => {
  const root = join(tmpdir(), `hydromart-visit-storage-${process.pid}`);
  const config = { storageLocalDir: root, storagePublicBaseUrl: 'http://localhost:3007' } as unknown as DepotConfigService;
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('writes under visits/<visitId>/, links it, and removes it (twice is fine)', async () => {
    const adapter = new VisitLocalStorageAdapter(config);
    const body = Buffer.from('photo');
    const { key } = await adapter.put({ visitId: V, body, contentType: 'image/png', ext: 'png' });

    expect(key).toMatch(new RegExp(`^visits/${V}/[0-9a-f-]{36}\\.png$`));
    expect(await readFile(join(root, key))).toEqual(body);
    await expect(adapter.signedUrl(key, 300)).resolves.toBe(`http://localhost:3007/uploads/${key}`);

    await adapter.remove(key);
    await expect(stat(join(root, key))).rejects.toBeDefined();
    await expect(adapter.remove(key)).resolves.toBeUndefined();
  });
});

describe('MulterExceptionFilter', () => {
  const run = (code: ConstructorParameters<typeof MulterError>[0]) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never;
    new MulterExceptionFilter().catch(new MulterError(code), host);
    return { status, json };
  };

  it('answers 413 for a file over the limit and 400 for anything else multer refuses', () => {
    const big = run('LIMIT_FILE_SIZE');
    expect(big.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(big.json.mock.calls[0][0]).toMatchObject({ message: 'file exceeds 5MB' });
    const other = run('LIMIT_UNEXPECTED_FILE');
    expect(other.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(other.json.mock.calls[0][0].error).toBe('Bad Request');
  });
});

describe('DepotConfigService (visits)', () => {
  const env: Record<string, string> = {
    VISIT_CHECKIN_RADIUS_M: '200',
    STORAGE_S3_ENDPOINT: 'https://nos.jkt-1.neo.id',
    VISIT_STORAGE_S3_BUCKET: 'hydromart-pod',
    VISIT_STORAGE_S3_ACCESS_KEY_ID: 'k',
    VISIT_STORAGE_S3_SECRET_ACCESS_KEY: 's',
  };
  const config = {
    get: jest.fn((key: string, dflt?: unknown) => (key in env ? env[key] : dflt)),
    getOrThrow: jest.fn((key: string) => env[key]),
  };
  const settings = { effective: jest.fn((_k, _t, envValue: number) => envValue) };
  const svc = new DepotConfigService(config as never, settings as never);

  it('reads the check-in radius as a per-depot tunable, default 200 m', () => {
    expect(svc.visitCheckInRadiusM()).toBe(200);
    expect(svc.visitCheckInRadiusM('depot-1')).toBe(200);
    expect(settings.effective).toHaveBeenLastCalledWith('visitCheckInRadiusM', 'int', 200, 'depot-1');
  });

  it('reads the private visit bucket, with the shared endpoint and an auto region by default', () => {
    expect(svc.visitS3).toEqual({
      endpoint: 'https://nos.jkt-1.neo.id',
      region: 'auto',
      bucket: 'hydromart-pod',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
  });
});

describe('VisitPrismaRepository', () => {
  const visit = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn() };
  const visitItem = { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn() };
  const repo = new VisitPrismaRepository({ visit, visitItem } as never);
  const NOW = new Date('2026-11-27T10:00:00.000Z');
  const itemRow = (over: object = {}) => ({ id: ITEM, visitId: V, depotId: DEPOT, followUpDueOn: new Date('2026-12-05T00:00:00.000Z'), result: 'FINDING', ...over });
  const visitRow = (over: object = {}) => ({ id: V, depotId: DEPOT, status: 'IN_PROGRESS', items: [itemRow()], ...over });

  beforeEach(() => jest.resetAllMocks());

  const newVisit = {
    depotId: DEPOT,
    templateId: 'tpl',
    templateName: 'Rutin',
    visitorId: ME,
    lat: -6.2,
    lng: 106.8,
    accuracyM: 12,
    distanceM: 5,
    approximateFix: false,
    fenceChecked: true,
    items: [{ position: 0, text: 'Lantai', sopId: null, sopVersionId: null, sopVersionNo: null, sopTitle: null }],
  };

  it('creates a visit with its copied lines (denormalised depot id, no template reference) and maps the day', async () => {
    visit.create.mockResolvedValue(visitRow());
    const out = await repo.create(newVisit);
    const arg = visit.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ depotId: DEPOT, visitorId: ME, checkInLat: -6.2, checkInDistanceM: 5, fenceChecked: true });
    expect(arg.data.items.create).toEqual([{ ...newVisit.items[0], depotId: DEPOT }]);
    expect(arg.include).toEqual({ items: { orderBy: { position: 'asc' } } });
    expect(out.items[0].followUpDueOn).toBe('2026-12-05');
  });

  it('turns the one-open-visit unique violation into the 409 that carries the open visit id', async () => {
    visit.create.mockRejectedValue({ code: 'P2002' });
    visit.findFirst.mockResolvedValue({ id: V });
    await expect(repo.create(newVisit)).rejects.toBeInstanceOf(VisitAlreadyOpenError);
    expect(visit.findFirst.mock.calls[0][0].where).toEqual({ visitorId: ME, depotId: DEPOT, status: VisitStatus.IN_PROGRESS });
  });

  it('rethrows a violation it cannot explain, and any other failure', async () => {
    const lost = { code: 'P2002' };
    visit.create.mockRejectedValueOnce(lost);
    visit.findFirst.mockResolvedValue(null);
    await expect(repo.create(newVisit)).rejects.toBe(lost);
    const other = new Error('db down');
    visit.create.mockRejectedValueOnce(other);
    await expect(repo.create(newVisit)).rejects.toBe(other);
  });

  it('reads open visits, one visit, one line', async () => {
    visit.findMany.mockResolvedValue([visitRow()]);
    await expect(repo.findOpenOf(ME)).resolves.toHaveLength(1);
    expect(visit.findMany.mock.calls[0][0].where).toEqual({ visitorId: ME, status: VisitStatus.IN_PROGRESS });

    visit.findUnique.mockResolvedValueOnce(visitRow()).mockResolvedValueOnce(null);
    await expect(repo.findById(V)).resolves.toMatchObject({ id: V });
    await expect(repo.findById(V)).resolves.toBeNull();

    visitItem.findUnique.mockResolvedValueOnce(itemRow({ followUpDueOn: null })).mockResolvedValueOnce(null);
    await expect(repo.findItem(ITEM)).resolves.toMatchObject({ followUpDueOn: null });
    await expect(repo.findItem(ITEM)).resolves.toBeNull();
  });

  it('writes an answer only while the visit is open, and resets the follow-up it replaces', async () => {
    visitItem.updateMany.mockResolvedValue({ count: 1 });
    visitItem.findUnique.mockResolvedValue(itemRow());
    await repo.answerItem(V, ITEM, {
      result: VisitItemResult.FINDING,
      findingNote: 'Licin',
      photoKey: 'k',
      followUpDueOn: '2026-12-05',
      followUpStatus: FollowUpStatus.OPEN,
    });
    expect(visitItem.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM, visitId: V, visit: { status: VisitStatus.IN_PROGRESS } },
      data: {
        result: VisitItemResult.FINDING,
        findingNote: 'Licin',
        photoKey: 'k',
        followUpDueOn: new Date('2026-12-05T00:00:00.000Z'),
        followUpStatus: FollowUpStatus.OPEN,
        followUpDoneAt: null,
        followUpDoneBy: null,
        followUpNote: null,
      },
    });

    await repo.answerItem(V, ITEM, { result: VisitItemResult.PASS, findingNote: null, photoKey: null, followUpDueOn: null, followUpStatus: null });
    expect(visitItem.updateMany.mock.calls[1][0].data.followUpDueOn).toBeNull();

    visitItem.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.answerItem(V, ITEM, { result: VisitItemResult.PASS, findingNote: null, photoKey: null, followUpDueOn: null, followUpStatus: null })).resolves.toBeNull();
  });

  it('completes only an open visit with nothing PENDING, in one write', async () => {
    visit.updateMany.mockResolvedValue({ count: 1 });
    visit.findUnique.mockResolvedValue(visitRow({ status: 'COMPLETED' }));
    await expect(repo.complete(V, NOW)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(visit.updateMany).toHaveBeenCalledWith({
      where: { id: V, status: VisitStatus.IN_PROGRESS, items: { none: { result: VisitItemResult.PENDING } } },
      data: { status: VisitStatus.COMPLETED, completedAt: NOW },
    });
    visit.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.complete(V, NOW)).resolves.toBeNull();
  });

  it('lists visits in scope, newest first, with counts', async () => {
    visit.count.mockResolvedValue(3);
    visit.findMany.mockResolvedValue([{ id: V, depotId: DEPOT, _count: { items: 4 }, items: [{ id: 'a' }, { id: 'b' }] }]);
    const out = await repo.list({ depotIds: [DEPOT], status: VisitStatus.COMPLETED, page: 2, pageSize: 10 });
    expect(visit.count).toHaveBeenCalledWith({ where: { depotId: { in: [DEPOT] }, status: VisitStatus.COMPLETED } });
    expect(visit.findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 10, orderBy: [{ checkInAt: 'desc' }, { id: 'asc' }] });
    expect(out).toEqual({ total: 3, items: [{ id: V, depotId: DEPOT, itemCount: 4, findingCount: 2 }] });

    await repo.list({ page: 1, pageSize: 10 });
    expect(visit.count).toHaveBeenLastCalledWith({ where: {} });
  });

  it.each([
    ['open', { followUpStatus: FollowUpStatus.OPEN }],
    ['done', { followUpStatus: FollowUpStatus.DONE }],
    ['overdue', { followUpStatus: FollowUpStatus.OPEN, followUpDueOn: { lt: new Date('2026-11-28T00:00:00.000Z') } }],
    [undefined, {}],
  ] as const)('lists findings for state %s', async (state, extra) => {
    visitItem.count.mockResolvedValue(1);
    visitItem.findMany.mockResolvedValue([itemRow()]);
    const out = await repo.findings({ depotIds: [DEPOT], state, todayKey: '2026-11-28', page: 1, pageSize: 20 });
    expect(visitItem.count).toHaveBeenCalledWith({ where: { depotId: { in: [DEPOT] }, result: VisitItemResult.FINDING, ...extra } });
    expect(out.items[0].followUpDueOn).toBe('2026-12-05');
  });

  it('adds the grouped counts up per depot, quiet ones left out', async () => {
    const D2 = '00000000-0000-4000-8000-0000000000d2';
    visit.groupBy.mockResolvedValueOnce([{ depotId: DEPOT, _max: { checkInAt: NOW } }]).mockResolvedValueOnce([{ depotId: D2, _count: { _all: 2 } }]);
    visitItem.groupBy.mockResolvedValueOnce([{ depotId: DEPOT, _count: { _all: 3 } }]).mockResolvedValueOnce([{ depotId: DEPOT, _count: { _all: 1 } }]);
    const out = await repo.overview(undefined, new Date('2026-10-28T00:00:00.000Z'), '2026-11-27');
    expect(out).toEqual([
      { depotId: DEPOT, lastVisitAt: NOW, visitsLast30d: 0, openFindings: 3, overdueFollowUps: 1 },
      { depotId: D2, lastVisitAt: null, visitsLast30d: 2, openFindings: 0, overdueFollowUps: 0 },
    ]);
    expect(visitItem.groupBy.mock.calls[1][0].where).toEqual({
      result: VisitItemResult.FINDING,
      followUpStatus: FollowUpStatus.OPEN,
      followUpDueOn: { lt: new Date('2026-11-27T00:00:00.000Z') },
    });
  });

  it('scopes the overview to the given depots', async () => {
    visit.groupBy.mockResolvedValue([]);
    visitItem.groupBy.mockResolvedValue([]);
    await expect(repo.overview([DEPOT], NOW, '2026-11-27')).resolves.toEqual([]);
    expect(visit.groupBy.mock.calls[0][0].where).toEqual({ depotId: { in: [DEPOT] } });
  });

  it('closes an open follow-up once, hands back a done one untouched, and ignores what is not a finding', async () => {
    visitItem.findUnique.mockResolvedValueOnce(itemRow({ followUpStatus: 'OPEN' })).mockResolvedValueOnce(itemRow({ followUpStatus: 'DONE' }));
    visitItem.updateMany.mockResolvedValue({ count: 1 });
    await repo.closeFollowUp(ITEM, ME, 'selesai', NOW);
    expect(visitItem.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM, followUpStatus: FollowUpStatus.OPEN },
      data: { followUpStatus: FollowUpStatus.DONE, followUpDoneAt: NOW, followUpDoneBy: ME, followUpNote: 'selesai' },
    });

    visitItem.updateMany.mockClear();
    visitItem.findUnique.mockReset();
    visitItem.findUnique.mockResolvedValue(itemRow({ followUpStatus: 'DONE' }));
    await expect(repo.closeFollowUp(ITEM, ME, null, NOW)).resolves.toMatchObject({ followUpStatus: 'DONE' });
    expect(visitItem.updateMany).not.toHaveBeenCalled();

    visitItem.findUnique.mockResolvedValue(itemRow({ result: 'PASS' }));
    await expect(repo.closeFollowUp(ITEM, ME, null, NOW)).resolves.toBeNull();
    visitItem.findUnique.mockResolvedValue(null);
    await expect(repo.closeFollowUp(ITEM, ME, null, NOW)).resolves.toBeNull();
  });

  it('counts open follow-ups past their WIB deadline, per depot and in total', async () => {
    visitItem.groupBy.mockResolvedValue([{ depotId: DEPOT, _count: { _all: 2 } }, { depotId: 'd2', _count: { _all: 3 } }]);
    await expect(repo.overdueCounts('2026-11-28')).resolves.toEqual({ depots: 2, items: 5 });
    expect(visitItem.groupBy.mock.calls[0][0].where.followUpDueOn).toEqual({ lt: new Date('2026-11-28T00:00:00.000Z') });
  });
});
