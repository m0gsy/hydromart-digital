import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ServiceUnavailableException } from '@nestjs/common';
import { alertServerError } from '@hydromart/platform';

import { FaceMaintenanceService } from '../../src/application/services/face-maintenance.service';
import type { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import type {
  FaceMaintenanceRepository,
  FaceShadowSample,
} from '../../src/application/ports/face-maintenance.repository';
import {
  FaceEngineUnavailableError,
  type FaceVerifier,
} from '../../src/application/ports/face-verifier.port';
import {
  LOCAL_TEMPLATE_DIM,
  LocalBadImageError,
  LocalNoFaceError,
} from '../../src/application/ports/local-face-engine.port';
import { HrConfigService } from '../../src/config/hr-config.service';
import { NeoFaceProvider } from '../../src/infrastructure/face/neo-face.provider';
import { ShadowFaceVerifier } from '../../src/infrastructure/face/shadow-face.verifier';
import { FaceMaintenancePrismaRepository } from '../../src/infrastructure/prisma/face-maintenance.prisma.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { FaceMaintenanceController } from '../../src/modules/face-maintenance.controller';

jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  alertServerError: jest.fn(),
}));
const alert = alertServerError as jest.Mock;

/*
 * Owner decision 2026-11-21: a daily face upkeep. NEO had lost faces it verified the day before
 * (32 refused check-ins), and kept the faces of two RESIGNED employees whose HR rows were purged.
 */

const NOW = new Date('2026-11-22T21:00:00Z');

function upkeepStore(enrolled: string[]) {
  const purgedBefore: Date[] = [];
  const store: FaceMaintenanceRepository = {
    activeEnrolledEmployeeIds: async () => enrolled,
    recordShadowSample: async () => undefined,
    purgeShadowSamples: async (before) => {
      purgedBefore.push(before);
      return 3;
    },
  };
  return { store, purgedBefore };
}

function engine(held: string[] | Error, over: Partial<FaceVerifier> = {}) {
  const removed: string[] = [];
  const verifier: FaceVerifier = {
    enroll: async () => ({ vector: [], quality: 1 }),
    verify: async () => ({ score: 1, matched: true }),
    listEnrolled: async () => {
      if (held instanceof Error) throw held;
      return held;
    },
    remove: async ({ userId }) => {
      removed.push(userId);
    },
    ...over,
  };
  return { verifier, removed };
}

function faces() {
  const retired: string[] = [];
  const repo = {
    deactivateForEmployee: async (id: string) => {
      retired.push(id);
    },
  } as unknown as FaceEmbeddingRepository;
  return { repo, retired };
}

const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

beforeEach(() => alert.mockClear());

describe('FaceMaintenanceService', () => {
  it('retires what the engine lost, deletes what it keeps for nobody, purges old samples', async () => {
    const { verifier, removed } = engine(['E-1', 'e-2', 'gone-1']);
    const { repo, retired } = faces();
    const { store, purgedBefore } = upkeepStore(['e-1', 'e-2', 'e-3']);
    const svc = new FaceMaintenanceService(verifier, repo, store);

    await expect(svc.run(NOW)).resolves.toEqual({ retired: 1, removed: 1, purgedSamples: 3, ok: true });
    expect(retired).toEqual(['e-3']); // case is not a difference: NEO answered E-1 for e-1
    expect(removed).toEqual(['gone-1']);
    expect(purgedBefore).toEqual([new Date('2026-10-23T21:00:00Z')]); // kept 30 days
    // A lost face is told; a leftover deleted is housekeeping, logged only.
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toMatchObject({ status: 404 });
    expect(String(alert.mock.calls[0][0].exception.message)).toContain('e-3');
  });

  it('has nothing to reconcile with an engine that keeps no gallery of its own', async () => {
    const { repo, retired } = faces();
    const local: FaceVerifier = {
      enroll: async () => ({ vector: [], quality: 1 }),
      verify: async () => ({ score: 1, matched: true }),
    };
    await expect(
      new FaceMaintenanceService(local, repo, upkeepStore(['e-1']).store).run(NOW),
    ).resolves.toEqual({ retired: 0, removed: 0, purgedSamples: 3, ok: true });
    expect(retired).toEqual([]);
  });

  it('touches nothing when the gallery cannot be listed', async () => {
    const { verifier, removed } = engine(new Error('NEO down'));
    const { repo, retired } = faces();
    await expect(
      new FaceMaintenanceService(verifier, repo, upkeepStore(['e-1']).store).run(NOW),
    ).resolves.toMatchObject({ retired: 0, removed: 0, ok: false });
    expect(retired).toEqual([]);
    expect(removed).toEqual([]);
  });

  // A list that disagrees wholesale is NEO failing or the wrong gallery, not people losing faces.
  it.each([
    ['HR lists nobody enrolled', ['e-1', 'e-2'], []],
    ['half of HR is missing from the gallery', ids(4, 'e'), ids(12, 'e')],
    ['half of the gallery is unknown to HR', [...ids(10, 'e'), ...ids(12, 'x')], ids(10, 'e')],
  ])('stops and tells ops when %s', async (_why, held, enrolled) => {
    const { verifier, removed } = engine(held);
    const { repo, retired } = faces();
    await expect(
      new FaceMaintenanceService(verifier, repo, upkeepStore(enrolled).store).run(NOW),
    ).resolves.toMatchObject({ retired: 0, removed: 0, ok: false });
    expect(retired).toEqual([]);
    expect(removed).toEqual([]);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toMatchObject({ status: 503 });
  });

  it('a leftover the engine refuses to delete is counted out and the round says so', async () => {
    const { verifier } = engine(['e-1', 'x-1', 'x-2'], {
      remove: async ({ userId }) => {
        if (userId === 'x-1') throw new Error('NEO 500');
      },
    });
    const { repo } = faces();
    await expect(
      new FaceMaintenanceService(verifier, repo, upkeepStore(['e-1']).store).run(NOW),
    ).resolves.toEqual({ retired: 0, removed: 1, purgedSamples: 3, ok: false });
  });

  it('runs for the scheduler through its controller', async () => {
    const run = jest.fn().mockResolvedValue({ retired: 0, removed: 0, purgedSamples: 0, ok: true });
    const controller = new FaceMaintenanceController({ run } as unknown as FaceMaintenanceService);
    await expect(controller.maintain()).resolves.toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('NeoFaceProvider.listEnrolled (GET list-faces with a JSON body)', () => {
  let server: Server;
  let base = '';
  let answer: (req: IncomingMessage, body: string, res: ServerResponse) => void = () => undefined;
  const seen: { method?: string; token?: string | string[]; body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, token: req.headers['accesstoken'], body });
        answer(req, body, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => {
    seen.length = 0;
  });

  const neo = (endpoint = base, token = 'tok') =>
    new NeoFaceProvider({
      neoFr: { endpoint, token, galleryId: 'g1' },
      neoLiveness: { mode: 'off', path: '/liveness' },
    } as unknown as HrConfigService);
  const reply = (status: number, text: string) => {
    answer = (_req, _body, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(text);
    };
  };

  it('reads every user id in the gallery, asked as a GET carrying the gallery in its body', async () => {
    reply(
      200,
      JSON.stringify({
        risetai: { status: '200', faces: [{ user_id: 'e-1' }, { user_id: 'e-2' }, { user_id: 7 }, {}] },
      }),
    );
    await expect(neo().listEnrolled()).resolves.toEqual(['e-1', 'e-2']);
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.token).toBe('tok');
    expect(JSON.parse(seen[0]?.body ?? '{}')).toMatchObject({ facegallery_id: 'g1' });
  });

  it('an empty gallery is an empty list', async () => {
    reply(200, JSON.stringify({ risetai: { status: '200' } }));
    await expect(neo().listEnrolled()).resolves.toEqual([]);
  });

  it('is never "an empty gallery" when NEO did not answer as itself', async () => {
    reply(502, '<html>bad gateway</html>');
    await expect(neo().listEnrolled()).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    reply(200, JSON.stringify({ risetai: { status: '415', status_message: 'Facegallery Not Found' } }));
    await expect(neo().listEnrolled()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(neo('http://127.0.0.1:1').listEnrolled()).rejects.toBeInstanceOf(FaceEngineUnavailableError);
    await expect(neo(base, '').listEnrolled()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('ShadowFaceVerifier keeps each comparison (2026-11-21)', () => {
  const unit = (i: number) => {
    const v = new Array(LOCAL_TEMPLATE_DIM).fill(0);
    v[i] = 1;
    return v;
  };
  const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
  const flush = () => new Promise((r) => setImmediate(r));
  const quiet = { log: jest.fn(), warn: jest.fn() };
  const primary = (): FaceVerifier => ({
    enroll: async () => ({ vector: [], quality: 1 }),
    verify: async () => ({ score: 0.8, matched: true }),
    listEnrolled: async () => ['e-1'],
  });

  it('records the local answer beside NEO’s, whatever it was', async () => {
    const kept: FaceShadowSample[] = [];
    const record = async (s: FaceShadowSample) => {
      kept.push(s);
    };
    const cases: [number[][], { embed: jest.Mock }][] = [
      [[unit(0)], { embed: jest.fn().mockResolvedValue({ vector: unit(0), detScore: 1 }) }],
      [[[]], { embed: jest.fn() }],
      [[unit(0)], { embed: jest.fn().mockRejectedValue(new LocalNoFaceError('x')) }],
      [[unit(0)], { embed: jest.fn().mockRejectedValue(new LocalBadImageError('small')) }],
      [[unit(0)], { embed: jest.fn().mockRejectedValue(new Error('down')) }],
    ];
    for (const [enrolled, local] of cases) {
      await new ShadowFaceVerifier(primary(), local, quiet, record).verify(JPEG, enrolled, {
        userId: 'e-1',
        userName: 'B',
      });
      await flush();
    }
    expect(kept.map((s) => [s.outcome, s.localScore])).toEqual([
      ['scored', 1],
      ['no-template', null],
      ['no-face', null],
      ['bad-image', null],
      ['failed', null],
    ]);
    expect(kept[0]).toMatchObject({ employeeId: 'e-1', neoScore: 0.8, neoMatched: true });
  });

  it('never lets keeping a sample touch the punch, and keeps none without an employee', async () => {
    const record = jest.fn().mockRejectedValue(new Error('db down'));
    const local = { embed: jest.fn().mockResolvedValue({ vector: unit(0), detScore: 1 }) };
    const v = new ShadowFaceVerifier(primary(), local, quiet, record);
    await expect(v.verify(JPEG, [unit(0)], { userId: 'e-1', userName: 'B' })).resolves.toMatchObject({
      matched: true,
    });
    await flush();
    await v.verify(JPEG, [unit(0)], undefined);
    await flush();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('lists the gallery through NEO', async () => {
    const v = new ShadowFaceVerifier(primary(), { embed: jest.fn() }, quiet);
    await expect(v.listEnrolled?.()).resolves.toEqual(['e-1']);
  });
});

describe('FaceMaintenancePrismaRepository', () => {
  const faceEmbedding = { findMany: jest.fn() };
  const faceShadowSample = { create: jest.fn(), deleteMany: jest.fn() };
  const repo = new FaceMaintenancePrismaRepository({
    faceEmbedding,
    faceShadowSample,
  } as unknown as PrismaService);

  it('reads one row per enrolled employee', async () => {
    faceEmbedding.findMany.mockResolvedValue([{ employeeId: 'e-1' }]);
    await expect(repo.activeEnrolledEmployeeIds()).resolves.toEqual(['e-1']);
    expect(faceEmbedding.findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { employeeId: true },
      distinct: ['employeeId'],
      take: 50_000,
    });
  });

  it('writes a sample and purges by age', async () => {
    const sample: FaceShadowSample = {
      employeeId: 'e-1',
      neoScore: 0.8,
      neoMatched: true,
      localScore: null,
      outcome: 'no-template',
    };
    await repo.recordShadowSample(sample);
    expect(faceShadowSample.create).toHaveBeenCalledWith({ data: sample });
    faceShadowSample.deleteMany.mockResolvedValue({ count: 4 });
    await expect(repo.purgeShadowSamples(NOW)).resolves.toBe(4);
    expect(faceShadowSample.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: NOW } } });
  });
});
