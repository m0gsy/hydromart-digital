import {
  FaceServiceClient,
  LOCAL_TEMPLATE_DIM,
  LocalEngineUnavailableError,
  LocalNoFaceError,
} from '../../src/infrastructure/face/face-service.client';
import { ShadowFaceVerifier } from '../../src/infrastructure/face/shadow-face.verifier';
import { FaceTemplateBackfill } from '../../src/application/services/face-template-backfill.service';
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

describe('FaceServiceClient', () => {
  const target = { url: 'http://face:3019/', internalKey: 'k' };

  it('posts the raw JPEG with the service key and returns the embedding', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { vector: unit(0), detScore: 0.93 }));
    const out = await new FaceServiceClient(target, fetchImpl).embed(JPEG);
    expect(out).toEqual({ vector: unit(0), detScore: 0.93 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://face:3019/api/v1/internal/embed');
    expect(init).toMatchObject({ method: 'POST', body: JPEG, headers: { 'x-internal-key': 'k', 'content-type': 'image/jpeg' } });
  });

  it('turns 422 NO_FACE into LocalNoFaceError, and every other refusal into unavailable', async () => {
    await expect(
      new FaceServiceClient(target, jest.fn().mockResolvedValue(reply(422, { code: 'NO_FACE' }))).embed(JPEG),
    ).rejects.toBeInstanceOf(LocalNoFaceError);
    await expect(
      new FaceServiceClient(target, jest.fn().mockResolvedValue(reply(503, { code: 'ENGINE_BUSY' }))).embed(JPEG),
    ).rejects.toThrow(/503 ENGINE_BUSY/);
    await expect(
      new FaceServiceClient(target, jest.fn().mockResolvedValue(reply(422, { code: 'IMAGE_TOO_SMALL' }))).embed(JPEG),
    ).rejects.toBeInstanceOf(LocalEngineUnavailableError);
    // A body that is not JSON at all.
    const noJson = { ok: false, status: 502, json: async () => { throw new Error('html'); } } as unknown as Response;
    await expect(new FaceServiceClient(target, jest.fn().mockResolvedValue(noJson)).embed(JPEG)).rejects.toThrow(/^face-service 502$/);
  });

  it('is unavailable when unreachable, unconfigured, or answering a shape it cannot trust', async () => {
    await expect(new FaceServiceClient(target, jest.fn().mockRejectedValue(new Error('ECONNREFUSED'))).embed(JPEG)).rejects.toThrow(/unreachable/);
    await expect(new FaceServiceClient({ url: '', internalKey: 'k' }, jest.fn()).embed(JPEG)).rejects.toThrow(/not set/);
    for (const body of [{ vector: [1, 2], detScore: 1 }, { vector: unit(0) }, { vector: [...unit(0).slice(1), NaN], detScore: 1 }, null]) {
      await expect(new FaceServiceClient(target, jest.fn().mockResolvedValue(reply(200, body))).embed(JPEG)).rejects.toThrow(/unexpected shape/);
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
    const v = new ShadowFaceVerifier(primary(), local, log);
    await v.verify(JPEG, [[]], undefined);
    await flush();
    expect(local.embed).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith('face shadow user=unknown neo=0.810 matched=true local=no-template');
  });

  it('never lets the local side fail the punch: no face and an outage are only logged', async () => {
    const log = logger();
    const noFace = new ShadowFaceVerifier(primary(), { embed: jest.fn().mockRejectedValue(new LocalNoFaceError('x')) }, log);
    await expect(noFace.verify(JPEG, [unit(0)], { userId: 'e1', userName: 'B' })).resolves.toBe(neoResult);
    await flush();
    const down = new ShadowFaceVerifier(primary(), { embed: jest.fn().mockRejectedValue(new LocalEngineUnavailableError('down')) }, log);
    await expect(down.verify(JPEG, [unit(0)], { userId: 'e2', userName: 'C' })).resolves.toBe(neoResult);
    await flush();
    expect(log.warn.mock.calls.map(([m]) => m)).toEqual([
      'face shadow user=e1 neo=0.810 matched=true local=no-face',
      'face shadow user=e2 neo=0.810 matched=true local=failed (Error: down)',
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
  const row = (id: string, key: string | null) => ({ id, employeeId: `emp-${id}`, sourcePhotoUrl: key });

  function make(rows: ReturnType<typeof row>[], over: { storage?: Partial<StoragePort> | null; set?: jest.Mock } = {}) {
    const faces = {
      listActiveWithoutLocalTemplate: jest.fn().mockResolvedValue(rows),
      setVectorIfActive: over.set ?? jest.fn().mockResolvedValue(true),
    } as unknown as FaceEmbeddingRepository;
    const storage =
      over.storage === null
        ? undefined
        : ({ getObject: jest.fn().mockResolvedValue({ body: JPEG, contentType: 'image/jpeg' }), ...over.storage } as StoragePort);
    const local = { embed: jest.fn().mockResolvedValue({ vector: unit(3), detScore: 0.9 }) };
    return { faces, storage, local, job: (mode: 'off' | 'shadow' = 'shadow', url?: string) => new FaceTemplateBackfill(faces, cfg(mode, url), local, storage) };
  }

  it('builds a template from each stored enrolment photo, only for keys it stored itself', async () => {
    const m = make([row('a', 'hr/faces/a.jpg'), row('b', 'https://elsewhere/b.jpg'), row('c', null)]);
    await expect(m.job().run()).resolves.toBe(1);
    expect(m.storage!.getObject).toHaveBeenCalledTimes(1);
    expect(m.faces.setVectorIfActive).toHaveBeenCalledWith('a', unit(3));
  });

  it('skips a photo it cannot read or embed, and carries on with the next', async () => {
    const getObject = jest
      .fn()
      .mockRejectedValueOnce(new Error('NoSuchKey'))
      .mockResolvedValue({ body: JPEG, contentType: 'image/jpeg' });
    const m = make([row('a', 'hr/faces/a.jpg'), row('b', 'hr/faces/b.jpg')], { storage: { getObject } });
    await expect(m.job().run()).resolves.toBe(1);
  });

  it('gives up on a photo read that hangs, after its timeout', async () => {
    jest.useFakeTimers();
    try {
      const m = make([row('a', 'hr/faces/a.jpg')], { storage: { getObject: () => new Promise(() => undefined) } });
      const run = m.job().run();
      await jest.advanceTimersByTimeAsync(FaceTemplateBackfill.PHOTO_TIMEOUT_MS + 1);
      await expect(run).resolves.toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not count a face withdrawn meanwhile', async () => {
    const m = make([row('a', 'hr/faces/a.jpg')], { set: jest.fn().mockResolvedValue(false) });
    await expect(m.job().run()).resolves.toBe(0);
  });

  it('never throws, even when the faces cannot be listed', async () => {
    const m = make([]);
    (m.faces.listActiveWithoutLocalTemplate as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(m.job().run()).resolves.toBe(0);
  });

  it('runs one at a time, and not at all without storage', async () => {
    let release!: (v: unknown[]) => void;
    const m = make([]);
    (m.faces.listActiveWithoutLocalTemplate as jest.Mock).mockReturnValue(new Promise((r) => (release = r)));
    const job = m.job();
    const first = job.run();
    await expect(job.run()).resolves.toBe(0);
    release([]);
    await first;
    await expect(make([], { storage: null }).job().run()).resolves.toBe(0);
  });

  it('starts only in shadow, with a face-service address and a store; on a half-hour timer', async () => {
    const spy = jest.spyOn(global, 'setInterval');
    try {
      for (const [mode, url, storage] of [['off', 'http://face', true], ['shadow', '', true], ['shadow', 'http://face', false]] as const) {
        const m = make([], { storage: storage ? undefined : null });
        m.job(mode, url).onApplicationBootstrap();
        expect(m.faces.listActiveWithoutLocalTemplate).not.toHaveBeenCalled();
      }
      const m = make([]);
      m.job().onApplicationBootstrap();
      await new Promise((r) => setImmediate(r));
      expect(m.faces.listActiveWithoutLocalTemplate).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), FaceTemplateBackfill.EVERY_MS);
      // The timer runs the same job.
      (spy.mock.calls.at(-1)![0] as () => void)();
      await new Promise((r) => setImmediate(r));
      expect(m.faces.listActiveWithoutLocalTemplate).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});
