import { FaceServiceClient } from '../../src/infrastructure/face/face-service.client';
import { ShadowFaceVerifier } from '../../src/infrastructure/face/shadow-face.verifier';
import {
  FaceTemplateBackfill,
  OWN_FACE_PHOTO,
} from '../../src/application/services/face-template-backfill.service';
import {
  LOCAL_TEMPLATE_DIM,
  LocalBadImageError,
  LocalEngineUnavailableError,
  LocalNoFaceError,
} from '../../src/application/ports/local-face-engine.port';
import type { FaceVerifier } from '../../src/application/ports/face-verifier.port';
import type { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import type { StoragePort } from '../../src/application/ports/storage.port';
import type { HrConfigService } from '../../src/config/hr-config.service';

const unit = (i: number) => {
  const v = new Array(LOCAL_TEMPLATE_DIM).fill(0);
  v[i] = 1;
  return v;
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const key = (n: number) => `hr/faces/00000000-0000-4000-a000-${String(n).padStart(12, '0')}.jpg`;

describe('FaceServiceClient', () => {
  const target = { url: 'http://face:3019/', internalKey: 'k' };
  const client = (res: Response | Error) =>
    new FaceServiceClient(target, res instanceof Error ? jest.fn().mockRejectedValue(res) : jest.fn().mockResolvedValue(res));

  it('posts the raw JPEG with the service key and returns the embedding', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { vector: unit(0), detScore: 0.93 }));
    const out = await new FaceServiceClient(target, fetchImpl).embed(JPEG);
    expect(out).toEqual({ vector: unit(0), detScore: 0.93 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://face:3019/api/v1/internal/embed');
    expect(init).toMatchObject({ method: 'POST', body: JPEG, headers: { 'x-internal-key': 'k', 'content-type': 'image/jpeg' } });
  });

  it('tells no face, a bad image and no answer apart', async () => {
    await expect(client(reply(422, { code: 'NO_FACE' })).embed(JPEG)).rejects.toBeInstanceOf(LocalNoFaceError);
    for (const [status, code] of [[422, 'IMAGE_TOO_SMALL'], [422, 'UNREADABLE_IMAGE'], [413, undefined], [400, undefined]] as const) {
      await expect(client(reply(status, code ? { code } : {})).embed(JPEG)).rejects.toBeInstanceOf(LocalBadImageError);
    }
    // A wrong key is a misconfiguration, not the photo; a busy engine is no answer.
    await expect(client(reply(401, {})).embed(JPEG)).rejects.toBeInstanceOf(LocalEngineUnavailableError);
    await expect(client(reply(503, { code: 'ENGINE_BUSY' })).embed(JPEG)).rejects.toThrow(/^face-service 503 ENGINE_BUSY$/);
    const noJson = { ok: false, status: 502, json: async () => { throw new Error('html'); } } as unknown as Response;
    await expect(client(noJson).embed(JPEG)).rejects.toThrow(/^face-service 502$/);
  });

  it('is unavailable when unreachable, unconfigured, or answering a shape it cannot trust', async () => {
    await expect(client(new Error('ECONNREFUSED')).embed(JPEG)).rejects.toThrow(/unreachable/);
    await expect(new FaceServiceClient({ url: '', internalKey: 'k' }, jest.fn()).embed(JPEG)).rejects.toThrow(/not set/);
    for (const body of [{ vector: [1, 2], detScore: 1 }, { vector: unit(0) }, { vector: [...unit(0).slice(1), NaN], detScore: 1 }, null]) {
      await expect(client(reply(200, body)).embed(JPEG)).rejects.toThrow(/unexpected shape/);
    }
  });

  it('uses the platform fetch by default', async () => {
    const real = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(reply(200, { vector: unit(1), detScore: 0.9 })) as typeof fetch;
    try {
      await expect(new FaceServiceClient(target).embed(JPEG)).resolves.toMatchObject({ detScore: 0.9 });
    } finally {
      global.fetch = real;
    }
  });
});

describe('ShadowFaceVerifier (FACE_FALLBACK=shadow)', () => {
  const neoResult = { score: 0.81, matched: true };
  const flush = () => new Promise((r) => setImmediate(r));
  const logger = () => ({ log: jest.fn(), warn: jest.fn() });
  const primary = (over: Partial<FaceVerifier> = {}): FaceVerifier => ({
    enroll: jest.fn().mockResolvedValue({ vector: [], quality: 1 }),
    verify: jest.fn().mockResolvedValue(neoResult),
    remove: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  it('returns exactly what NEO said, and logs the local score beside it', async () => {
    const log = logger();
    const local = { embed: jest.fn().mockResolvedValue({ vector: unit(0), detScore: 0.9 }) };
    const v = new ShadowFaceVerifier(primary(), local, log);
    await expect(v.verify(JPEG, [unit(0), unit(1)], { userId: 'e1', userName: 'Budi' })).resolves.toBe(neoResult);
    await flush();
    expect(log.log).toHaveBeenCalledWith('face shadow user=e1 neo=0.810 matched=true local=1.000');
  });

  it('says when there is no local template yet, without asking face-service', async () => {
    const log = logger();
    const local = { embed: jest.fn() };
    await new ShadowFaceVerifier(primary(), local, log).verify(JPEG, [[]], undefined);
    await flush();
    expect(local.embed).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith('face shadow user=unknown neo=0.810 matched=true local=no-template');
  });

  it('never lets the local side fail the punch: no face, a bad image and an outage are only logged', async () => {
    const log = logger();
    const cases: [string, Error][] = [
      ['e1', new LocalNoFaceError('x')],
      ['e2', new LocalBadImageError('face-service 422 IMAGE_TOO_SMALL')],
      ['e3', new LocalEngineUnavailableError('down')],
    ];
    for (const [who, err] of cases) {
      const v = new ShadowFaceVerifier(primary(), { embed: jest.fn().mockRejectedValue(err) }, log);
      await expect(v.verify(JPEG, [unit(0)], { userId: who, userName: 'B' })).resolves.toBe(neoResult);
      await flush();
    }
    expect(log.warn.mock.calls.map(([m]) => m)).toEqual([
      'face shadow user=e1 neo=0.810 matched=true local=no-face',
      'face shadow user=e2 neo=0.810 matched=true local=bad-image (face-service 422 IMAGE_TOO_SMALL)',
      'face shadow user=e3 neo=0.810 matched=true local=failed (Error: down)',
    ]);
  });

  it('compares one at a time: a punch during a comparison is not compared', async () => {
    let release!: () => void;
    const local = {
      embed: jest.fn(() => new Promise<{ vector: number[]; detScore: number }>((r) => (release = () => r({ vector: unit(0), detScore: 1 })))),
    };
    const v = new ShadowFaceVerifier(primary(), local, logger());
    await v.verify(JPEG, [unit(0)], undefined);
    await v.verify(JPEG, [unit(0)], undefined);
    expect(local.embed).toHaveBeenCalledTimes(1);
    release();
    await flush();
    await v.verify(JPEG, [unit(0)], undefined);
    expect(local.embed).toHaveBeenCalledTimes(2);
  });

  it('passes NEO failures through untouched and does not compare', async () => {
    const local = { embed: jest.fn() };
    const v = new ShadowFaceVerifier(primary({ verify: jest.fn().mockRejectedValue(new Error('quota')) }), local, logger());
    await expect(v.verify(JPEG, [unit(0)], undefined)).rejects.toThrow('quota');
    expect(local.embed).not.toHaveBeenCalled();
  });

  it('enrolls and removes through NEO; no remove when NEO has none', async () => {
    const p = primary();
    const v = new ShadowFaceVerifier(p, { embed: jest.fn() }, logger());
    await v.enroll([JPEG], { userId: 'e1', userName: 'B' });
    await v.remove!({ userId: 'e1', userName: 'B' });
    expect(p.enroll).toHaveBeenCalled();
    expect(p.remove).toHaveBeenCalledWith({ userId: 'e1', userName: 'B' });
    expect(new ShadowFaceVerifier(primary({ remove: undefined }), { embed: jest.fn() }).remove).toBeUndefined();
  });
});

describe('FaceTemplateBackfill', () => {
  const cfg = (faceFallback: 'off' | 'shadow', url = 'http://face:3019') =>
    ({ faceFallback, faceServiceUrl: url }) as unknown as HrConfigService;
  const row = (id: string, sourcePhotoUrl: string | null) => ({ id, employeeId: `emp-${id}`, sourcePhotoUrl });

  function make(rows: ReturnType<typeof row>[], over: { storage?: Partial<StoragePort> | null; set?: jest.Mock; embed?: jest.Mock } = {}) {
    const faces = {
      listActiveWithoutLocalTemplate: jest.fn().mockResolvedValue(rows),
      setVectorIfActive: over.set ?? jest.fn().mockResolvedValue(true),
    } as unknown as FaceEmbeddingRepository & { listActiveWithoutLocalTemplate: jest.Mock };
    const storage =
      over.storage === null
        ? undefined
        : ({ getObject: jest.fn().mockResolvedValue({ body: JPEG, contentType: 'image/jpeg' }), ...over.storage } as StoragePort);
    const local = { embed: over.embed ?? jest.fn().mockResolvedValue({ vector: unit(3), detScore: 0.9 }) };
    return {
      faces,
      storage,
      local,
      job: (mode: 'off' | 'shadow' = 'shadow', url?: string) => new FaceTemplateBackfill(faces, cfg(mode, url), local, storage),
    };
  }

  it('takes only the frames this service stored itself', () => {
    expect(OWN_FACE_PHOTO.test(key(1))).toBe(true);
    for (const k of ['hr/faces/a.jpg', 'hr/faces/../hr/faces/x.jpg', 'https://bucket/hr/faces/x.jpg', `${key(1)}.png`]) {
      expect(OWN_FACE_PHOTO.test(k)).toBe(false);
    }
  });

  it('builds a template from each stored enrolment photo, and sets aside a key it did not store', async () => {
    const m = make([row('a', key(1)), row('b', 'hr/faces/typed-by-an-admin.jpg'), row('c', null)]);
    const job = m.job();
    await expect(job.run()).resolves.toBe(1);
    expect(m.storage!.getObject).toHaveBeenCalledTimes(1);
    expect(m.faces.setVectorIfActive).toHaveBeenCalledWith('a', unit(3));
    await job.run();
    expect(m.faces.listActiveWithoutLocalTemplate).toHaveBeenLastCalledWith(FaceTemplateBackfill.BATCH, ['b', 'c']);
  });

  it('sets aside for good what cannot succeed — no face, a bad image, a photo that is gone — and retries the rest', async () => {
    const embed = jest
      .fn()
      .mockRejectedValueOnce(new LocalNoFaceError('x'))
      .mockRejectedValueOnce(new LocalBadImageError('422'))
      .mockRejectedValueOnce(new Error('socket hang up')) // transient: next run again
      .mockResolvedValue({ vector: unit(3), detScore: 0.9 });
    const getObject = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchKey' }))
      .mockResolvedValue({ body: JPEG, contentType: 'image/jpeg' });
    const m = make([row('gone', key(0)), row('a', key(1)), row('b', key(2)), row('c', key(3)), row('d', key(4))], { storage: { getObject }, embed });
    const job = m.job();
    await expect(job.run()).resolves.toBe(1);
    await job.run();
    expect(m.faces.listActiveWithoutLocalTemplate).toHaveBeenLastCalledWith(FaceTemplateBackfill.BATCH, ['gone', 'a', 'b']);
  });

  it('ends the run when face-service is down: the rest would fail the same way', async () => {
    const embed = jest.fn().mockRejectedValue(new LocalEngineUnavailableError('down'));
    const m = make([row('a', key(1)), row('b', key(2))], { embed });
    const job = m.job();
    await expect(job.run()).resolves.toBe(0);
    expect(embed).toHaveBeenCalledTimes(1);
    await job.run();
    expect(m.faces.listActiveWithoutLocalTemplate).toHaveBeenLastCalledWith(FaceTemplateBackfill.BATCH, []);
  });

  it('gives up on a photo read that hangs, after its timeout', async () => {
    jest.useFakeTimers();
    try {
      const m = make([row('a', key(1))], { storage: { getObject: () => new Promise(() => undefined) } });
      const run = m.job().run();
      await jest.advanceTimersByTimeAsync(FaceTemplateBackfill.PHOTO_TIMEOUT_MS + 1);
      await expect(run).resolves.toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not count a face withdrawn (or an employee gone) meanwhile', async () => {
    const m = make([row('a', key(1))], { set: jest.fn().mockResolvedValue(false) });
    await expect(m.job().run()).resolves.toBe(0);
  });

  it('never throws, even when the faces cannot be listed', async () => {
    const m = make([]);
    m.faces.listActiveWithoutLocalTemplate.mockRejectedValue(new Error('db down'));
    await expect(m.job().run()).resolves.toBe(0);
  });

  it('runs one at a time, and not at all without storage', async () => {
    let release!: (v: unknown[]) => void;
    const m = make([]);
    m.faces.listActiveWithoutLocalTemplate.mockReturnValue(new Promise((r) => (release = r)));
    const job = m.job();
    const first = job.run();
    await expect(job.run()).resolves.toBe(0);
    release([]);
    await first;
    await expect(make([], { storage: null }).job().run()).resolves.toBe(0);
  });

  it('starts only in shadow, with a face-service address and a store; on a half-hour timer it stops on shutdown', async () => {
    const every = jest.spyOn(global, 'setInterval');
    const stop = jest.spyOn(global, 'clearInterval');
    try {
      for (const [mode, url, storage] of [['off', 'http://face', true], ['shadow', '', true], ['shadow', 'http://face', false]] as const) {
        const m = make([], { storage: storage ? undefined : null });
        const job = m.job(mode, url);
        job.onApplicationBootstrap();
        job.onModuleDestroy(); // nothing started, nothing to stop
        expect(m.faces.listActiveWithoutLocalTemplate).not.toHaveBeenCalled();
      }
      expect(stop).not.toHaveBeenCalled();
      const m = make([]);
      const job = m.job();
      job.onApplicationBootstrap();
      await new Promise((r) => setImmediate(r));
      expect(m.faces.listActiveWithoutLocalTemplate).toHaveBeenCalledTimes(1);
      expect(every).toHaveBeenCalledWith(expect.any(Function), FaceTemplateBackfill.EVERY_MS);
      (every.mock.calls.at(-1)![0] as () => void)();
      await new Promise((r) => setImmediate(r));
      expect(m.faces.listActiveWithoutLocalTemplate).toHaveBeenCalledTimes(2);
      job.onModuleDestroy();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      every.mockRestore();
      stop.mockRestore();
    }
  });
});
