const send = jest.fn().mockResolvedValue({});
const getSignedUrl = jest.fn().mockResolvedValue('https://signed.example/visits/k?X-Amz-Expires=300');
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'get', input })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'head', input })),
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
import {
  VisitDisabledStorageAdapter,
  visitPhotoStorageFor,
} from '../../src/infrastructure/storage/visit-storage.factory';
import { VisitPhotoNotConfiguredError } from '../../src/domain/errors';
import { MulterExceptionFilter } from '../../src/modules/multer-exception.filter';

const V = '00000000-0000-4000-8000-0000000000b1';
const DEPOT = '00000000-0000-4000-8000-0000000000d1';
const ITEM = '00000000-0000-4000-8000-0000000000e1';
const ME = '00000000-0000-4000-8000-000000000001';

describe('VisitS3StorageAdapter', () => {
  const settings = {
    endpoint: 'https://nos.jkt-1.neo.id',
    region: 'jkt-1',
    bucket: 'hydromart-visits',
    accessKeyId: 'k',
    secretAccessKey: 's',
  };

  beforeEach(() => jest.clearAllMocks());

  it('puts under visits/<visitId>/<uuid>.<ext> in the private bucket and returns only the key', async () => {
    const body = Buffer.from('bytes');
    const adapter = new VisitS3StorageAdapter(settings);
    const { key } = await adapter.put({ visitId: V, body, contentType: 'image/webp', ext: 'webp' });

    expect(key).toMatch(new RegExp(`^visits/${V}/[0-9a-f-]{36}\\.webp$`));
    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://nos.jkt-1.neo.id', forcePathStyle: true }));
    expect(PutObjectCommand).toHaveBeenCalledWith({ Bucket: 'hydromart-visits', Key: key, Body: body, ContentType: 'image/webp' });
    expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('mints a signed read link for the key, expiring as asked, and removes by key', async () => {
    const adapter = new VisitS3StorageAdapter(settings);
    await expect(adapter.signedUrl(`visits/${V}/a.jpg`, 300)).resolves.toContain('signed.example');
    expect(getSignedUrl.mock.calls[0][1]).toEqual({ kind: 'get', input: { Bucket: 'hydromart-visits', Key: `visits/${V}/a.jpg` } });
    expect(getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 300 });

    await adapter.remove(`visits/${V}/a.jpg`);
    expect(send.mock.calls[0][0]).toEqual({ kind: 'delete', input: { Bucket: 'hydromart-visits', Key: `visits/${V}/a.jpg` } });
    expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });
});

describe('VisitS3StorageAdapter.exists', () => {
  const settings = { endpoint: 'https://nos.jkt-1.neo.id', region: 'jkt-1', bucket: 'hydromart-visits', accessKeyId: 'k', secretAccessKey: 's' };
  beforeEach(() => send.mockReset());

  it('is true for an object that is there, asking with a HEAD and a timeout', async () => {
    send.mockResolvedValue({});
    await expect(new VisitS3StorageAdapter(settings).exists('visits/x.jpg')).resolves.toBe(true);
    expect(send.mock.calls[0][0]).toEqual({ kind: 'head', input: { Bucket: 'hydromart-visits', Key: 'visits/x.jpg' } });
    expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('is false only for a 404, and throws for every other failure', async () => {
    const adapter = new VisitS3StorageAdapter(settings);
    send.mockRejectedValueOnce({ name: 'NotFound' });
    await expect(adapter.exists('k')).resolves.toBe(false);
    send.mockRejectedValueOnce({ name: 'Other', $metadata: { httpStatusCode: 404 } });
    await expect(adapter.exists('k')).resolves.toBe(false);
    const forbidden = { name: 'Forbidden', $metadata: { httpStatusCode: 403 } };
    send.mockRejectedValueOnce(forbidden);
    await expect(adapter.exists('k')).rejects.toBe(forbidden);
    const bare = new Error('socket');
    send.mockRejectedValueOnce(bare);
    await expect(adapter.exists('k')).rejects.toBe(bare);
  });
});

describe('visitPhotoStorageFor', () => {
  const s3 = { endpoint: 'https://nos', region: 'jkt-1', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' };
  const cfg = (over: object) => ({ storageDriver: 's3', isProduction: true, visitS3: s3, ...over }) as unknown as DepotConfigService;

  it('uses the private bucket when the s3 driver has its own bucket and key', () => {
    expect(visitPhotoStorageFor(cfg({}))).toBeInstanceOf(VisitS3StorageAdapter);
  });

  it('is disabled, not a boot failure, when the s3 driver has no visit bucket yet', async () => {
    const store = visitPhotoStorageFor(cfg({ visitS3: null }));
    expect(store).toBeInstanceOf(VisitDisabledStorageAdapter);
    await expect(store.put({ visitId: V, body: Buffer.from('x'), contentType: 'image/png', ext: 'png' })).rejects.toBeInstanceOf(VisitPhotoNotConfiguredError);
    await expect(store.signedUrl('k', 1)).rejects.toBeInstanceOf(VisitPhotoNotConfiguredError);
    await expect(store.exists('k')).rejects.toBeInstanceOf(VisitPhotoNotConfiguredError);
    await expect(store.remove('k')).rejects.toBeInstanceOf(VisitPhotoNotConfiguredError);
  });

  it('keeps photos on a local disk in development only, never in production', () => {
    expect(visitPhotoStorageFor(cfg({ storageDriver: 'local', isProduction: false }))).toBeInstanceOf(VisitLocalStorageAdapter);
    expect(visitPhotoStorageFor(cfg({ storageDriver: 'local', isProduction: true }))).toBeInstanceOf(VisitDisabledStorageAdapter);
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
    await expect(adapter.exists(key)).resolves.toBe(true);

    await adapter.remove(key);
    await expect(stat(join(root, key))).rejects.toBeDefined();
    await expect(adapter.remove(key)).resolves.toBeUndefined();
    await expect(adapter.exists(key)).resolves.toBe(false);
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

  it.each(['VISIT_STORAGE_S3_BUCKET', 'VISIT_STORAGE_S3_ACCESS_KEY_ID', 'VISIT_STORAGE_S3_SECRET_ACCESS_KEY'])(
    'has no visit bucket while %s is unset: photos are off, nothing else is',
    (key) => {
      const saved = env[key];
      env[key] = '';
      try {
        expect(svc.visitS3).toBeNull();
      } finally {
        env[key] = saved;
      }
    },
  );
});

describe('VisitPrismaRepository', () => {
  const visit = { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn() };
  const visitItem = { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn() };
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

  it('counts a photo against an open visit up to its cap, and gives a slot back', async () => {
    visit.updateMany.mockResolvedValue({ count: 1 });
    await expect(repo.reserveUpload(V, 6)).resolves.toBe(true);
    expect(visit.updateMany).toHaveBeenLastCalledWith({
      where: { id: V, status: VisitStatus.IN_PROGRESS, photoUploads: { lt: 6 } },
      data: { photoUploads: { increment: 1 } },
    });
    visit.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.reserveUpload(V, 6)).resolves.toBe(false);

    await repo.releaseUpload(V);
    expect(visit.updateMany).toHaveBeenLastCalledWith({
      where: { id: V, photoUploads: { gt: 0 } },
      data: { photoUploads: { decrement: 1 } },
    });
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
    expect(visitItem.count).toHaveBeenCalledWith({
      where: { depotId: { in: [DEPOT] }, result: VisitItemResult.FINDING, visit: { status: VisitStatus.COMPLETED }, ...extra },
    });
    expect(out.items[0].followUpDueOn).toBe('2026-12-05');
  });

  it('adds the grouped counts up per depot, quiet ones left out', async () => {
    const D2 = '00000000-0000-4000-8000-0000000000d2';
    visit.groupBy
      .mockResolvedValueOnce([{ depotId: DEPOT, _max: { checkInAt: NOW } }])
      .mockResolvedValueOnce([{ depotId: D2, _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ depotId: D2, _count: { _all: 1 } }]);
    visitItem.groupBy.mockResolvedValueOnce([{ depotId: DEPOT, _count: { _all: 3 } }]).mockResolvedValueOnce([{ depotId: DEPOT, _count: { _all: 1 } }]);
    const out = await repo.overview(undefined, new Date('2026-10-28T00:00:00.000Z'), '2026-11-27');
    expect(out).toEqual([
      { depotId: DEPOT, lastVisitAt: NOW, visitsLast30d: 0, unfencedVisitsLast30d: 0, openFindings: 3, overdueFollowUps: 1 },
      { depotId: D2, lastVisitAt: null, visitsLast30d: 2, unfencedVisitsLast30d: 1, openFindings: 0, overdueFollowUps: 0 },
    ]);
    expect(visitItem.groupBy.mock.calls[1][0].where).toEqual({
      result: VisitItemResult.FINDING,
      followUpStatus: FollowUpStatus.OPEN,
      visit: { status: VisitStatus.COMPLETED },
      followUpDueOn: { lt: new Date('2026-11-27T00:00:00.000Z') },
    });
    // the unfenced count: this window, fence off
    expect(visit.groupBy.mock.calls[2][0].where).toEqual({ checkInAt: { gte: new Date('2026-10-28T00:00:00.000Z') }, fenceChecked: false });
  });

  it('scopes the overview to the given depots', async () => {
    visit.groupBy.mockResolvedValue([]);
    visitItem.groupBy.mockResolvedValue([]);
    await expect(repo.overview([DEPOT], NOW, '2026-11-27')).resolves.toEqual([]);
    expect(visit.groupBy.mock.calls[0][0].where).toEqual({ depotId: { in: [DEPOT] } });
  });

  it('closes an open follow-up once, only for a finding of a COMPLETED visit', async () => {
    visitItem.findFirst.mockResolvedValueOnce(itemRow({ followUpStatus: 'OPEN' }));
    visitItem.updateMany.mockResolvedValue({ count: 1 });
    visitItem.findUnique.mockResolvedValue(itemRow({ followUpStatus: 'DONE' }));
    await expect(repo.closeFollowUp(ITEM, ME, 'selesai', NOW)).resolves.toMatchObject({ followUpStatus: 'DONE' });
    expect(visitItem.findFirst).toHaveBeenCalledWith({
      where: { id: ITEM, result: VisitItemResult.FINDING, visit: { status: VisitStatus.COMPLETED } },
    });
    expect(visitItem.updateMany).toHaveBeenCalledWith({
      where: { id: ITEM, followUpStatus: FollowUpStatus.OPEN },
      data: { followUpStatus: FollowUpStatus.DONE, followUpDoneAt: NOW, followUpDoneBy: ME, followUpNote: 'selesai' },
    });
  });

  it('hands back an already DONE follow-up untouched, and ignores a line of a draft visit or one that is not a finding', async () => {
    visitItem.findFirst.mockResolvedValueOnce(itemRow({ followUpStatus: 'DONE' }));
    await expect(repo.closeFollowUp(ITEM, ME, null, NOW)).resolves.toMatchObject({ followUpStatus: 'DONE' });
    expect(visitItem.updateMany).not.toHaveBeenCalled();

    visitItem.findFirst.mockResolvedValueOnce(null);
    await expect(repo.closeFollowUp(ITEM, ME, null, NOW)).resolves.toBeNull();
  });

  it('counts open follow-ups past their WIB deadline, per depot and in total', async () => {
    visitItem.groupBy.mockResolvedValue([{ depotId: DEPOT, _count: { _all: 2 } }, { depotId: 'd2', _count: { _all: 3 } }]);
    await expect(repo.overdueCounts('2026-11-28')).resolves.toEqual({ depots: 2, items: 5 });
    expect(visitItem.groupBy.mock.calls[0][0].where.followUpDueOn).toEqual({ lt: new Date('2026-11-28T00:00:00.000Z') });
  });

  it('counts per asked depot, zeros included, and reads only COMPLETED visits and open findings of them', async () => {
    visit.groupBy
      .mockResolvedValueOnce([{ depotId: DEPOT, _count: { _all: 4 } }])
      .mockResolvedValueOnce([{ depotId: DEPOT, _max: { completedAt: new Date('2026-11-20T03:00:00.000Z') } }]);
    visitItem.groupBy
      .mockResolvedValueOnce([{ depotId: DEPOT, _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ depotId: DEPOT, _count: { _all: 3 } }])
      .mockResolvedValueOnce([{ depotId: DEPOT, _count: { _all: 1 } }]);
    const from = new Date('2026-10-31T17:00:00.000Z');
    const to = new Date('2026-11-30T17:00:00.000Z');
    await expect(repo.aiSummary([DEPOT, 'd2'], from, to, '2026-11-28')).resolves.toEqual([
      { depotId: DEPOT, completed: 4, findings: 2, lastCompletedAt: new Date('2026-11-20T03:00:00.000Z'), followUpsOpen: 3, followUpsOverdue: 1 },
      { depotId: 'd2', completed: 0, findings: 0, lastCompletedAt: null, followUpsOpen: 0, followUpsOverdue: 0 },
    ]);
    expect(visit.groupBy.mock.calls[0][0].where).toEqual({ depotId: { in: [DEPOT, 'd2'] }, status: 'COMPLETED', completedAt: { gte: from, lt: to } });
    expect(visitItem.groupBy.mock.calls[0][0].where.visit).toEqual({ status: 'COMPLETED', checkInAt: { gte: from, lt: to } });
    expect(visitItem.groupBy.mock.calls[2][0].where.followUpDueOn).toEqual({ lt: new Date('2026-11-28T00:00:00.000Z') });
  });
});

describe('VISIT_NOTIFY_ENABLED', () => {
  const flag = (value: unknown) =>
    new DepotConfigService({ get: (_k: string, dflt?: unknown) => (value === undefined ? dflt : value) } as never, {} as never)
      .visitNotifyEnabled;

  it('is off by default and on only for true', () => {
    expect(flag(undefined)).toBe(false);
    expect(flag(false)).toBe(false);
    expect(flag(true)).toBe(true);
    expect(flag('true')).toBe(true);
  });
});

describe('VisitNotifierHttpAdapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { VisitNotifierHttpAdapter } = require('../../src/infrastructure/http/visit-notifier.http.adapter');
  const notice = { kind: 'OVERDUE', depotId: 'd', depotName: 'Depot A', dateKey: '2026-11-27', items: ['x'] };
  const adapter = (over: object = {}) =>
    new VisitNotifierHttpAdapter({ crmServiceUrl: 'http://crm', internalServiceKey: 'k', ...over });
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts to crm with the internal key and says true on 2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never;
    const timer = jest.spyOn(global, 'setTimeout');
    await expect(adapter().notify(notice)).resolves.toBe(true);
    expect(timer.mock.calls.some((c) => c[1] === 30_000)).toBe(true); // crm files every recipient before answering
    timer.mockRestore();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://crm/api/v1/notifications/internal/visit-notice');
    expect(init.headers['x-internal-key']).toBe('k');
    expect(JSON.parse(init.body)).toEqual(notice);
  });

  it('fails open: a non-2xx, a network error or a missing url/key answers false', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as never;
    await expect(adapter().notify(notice)).resolves.toBe(false);
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    await expect(adapter().notify(notice)).resolves.toBe(false);
    global.fetch = jest.fn() as never;
    await expect(adapter({ crmServiceUrl: '' }).notify(notice)).resolves.toBe(false);
    await expect(adapter({ internalServiceKey: '' }).notify(notice)).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('VisitPrismaRepository overdue reminders', () => {
  const visitItem = { findMany: jest.fn(), updateMany: jest.fn() };
  const repo = new VisitPrismaRepository({ visit: {}, visitItem } as never);
  beforeEach(() => jest.resetAllMocks());

  it('reads depots first, then at most perDepot follow-ups of each (oldest deadline first), so no depot starves another', async () => {
    const cutoff = new Date('2026-11-24T10:00:00.000Z');
    const visitItemGroup = visitItem as unknown as { groupBy: jest.Mock };
    visitItemGroup.groupBy = jest.fn().mockResolvedValue([{ depotId: 'd1' }, { depotId: 'd2' }]);
    visitItem.findMany
      .mockResolvedValueOnce([{ id: 'i1', depotId: 'd1', text: 'Filter', findingNote: 'Kotor', visit: { depot: { name: 'Depot A' } } }])
      .mockResolvedValueOnce([{ id: 'i2', depotId: 'd2', text: 'Lantai', findingNote: null, visit: { depot: { name: 'Depot B' } } }]);
    await expect(repo.overdueToRemind('2026-11-28', cutoff, 30, 500)).resolves.toEqual([
      { id: 'i1', depotId: 'd1', depotName: 'Depot A', text: 'Filter', findingNote: 'Kotor' },
      { id: 'i2', depotId: 'd2', depotName: 'Depot B', text: 'Lantai', findingNote: null },
    ]);
    const g = visitItemGroup.groupBy.mock.calls[0][0];
    expect(g.take).toBe(500);
    expect(g.where.followUpDueOn).toEqual({ lt: new Date('2026-11-28T00:00:00.000Z') });
    expect(g.where.OR).toEqual([{ lastOverdueNoticeAt: null }, { lastOverdueNoticeAt: { lt: cutoff } }]);
    expect(visitItem.findMany.mock.calls.map((c) => [c[0].where.depotId, c[0].take])).toEqual([['d1', 30], ['d2', 30]]);
  });

  it('stamps the reminded follow-ups, and does nothing for none', async () => {
    const now = new Date('2026-11-27T00:30:00.000Z');
    await repo.stampOverdueNotice([], now);
    expect(visitItem.updateMany).not.toHaveBeenCalled();
    await repo.stampOverdueNotice(['i1', 'i2'], now);
    expect(visitItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['i1', 'i2'] } }, data: { lastOverdueNoticeAt: now } });
  });
});
