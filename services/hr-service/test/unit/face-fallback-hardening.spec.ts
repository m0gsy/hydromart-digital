/**
 * Face-fallback plan PR-2, the half that does not depend on a local engine: the HR queue alarm,
 * templates that cannot be compared or decrypted, and enrolment answers that carry no template.
 */
jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  alertServerError: jest.fn(),
}));

import { alertServerError } from '@hydromart/platform';

import { PendingPunchAlert } from '../../src/application/services/pending-punch-alert.service';
import { AttendanceRepository } from '../../src/application/ports/attendance.repository';
import { HrConfigService } from '../../src/config/hr-config.service';
import { bestMatch } from '../../src/domain/face-math';
import { encryptVector } from '../../src/infrastructure/crypto/face-vector.cipher';
import { AttendancePrismaRepository } from '../../src/infrastructure/prisma/attendance.prisma.repository';
import { FaceEmbeddingPrismaRepository } from '../../src/infrastructure/prisma/face-embedding.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { FaceController, SelfFaceController, faceView } from '../../src/modules/face.controller';
import { FaceEngineUnavailableError } from '../../src/application/ports/face-verifier.port';
import { StubFaceVerifier } from '../../src/infrastructure/face/stub-face.verifier';

const alert = alertServerError as jest.Mock;
const config = { timeZone: 'Asia/Jakarta', faceEncryptionKey: 'unit-test-face-key' } as HrConfigService;
/** 09:15 WIB on 19 Nov 2026, and two hours later. */
const NINE = new Date('2026-11-19T02:15:00.000Z');
const ELEVEN = new Date('2026-11-19T04:15:00.000Z');

beforeEach(() => alert.mockReset());

describe('the alarm for punches left PENDING', () => {
  const watch = (waiting: number | Error) => {
    const count = jest.fn(async () => {
      if (waiting instanceof Error) throw waiting;
      return waiting;
    });
    const repo = { countPendingOlderThan: count } as unknown as AttendanceRepository;
    return { count, alarm: new PendingPunchAlert(repo, config) };
  };

  it('tells ops in the 09:00 hour when a punch has waited more than 48 hours', async () => {
    const { count, alarm } = watch(3);
    await expect(alarm.tick(NINE)).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith(new Date(NINE.getTime() - 48 * 3_600_000));
    expect(alert).toHaveBeenCalledTimes(1);
    expect((alert.mock.calls[0][0] as { exception: Error }).exception.message).toMatch(/^3 absen PENDING/);
  });

  it('says it at most once a day', async () => {
    const { alarm } = watch(3);
    await alarm.tick(NINE);
    await expect(alarm.tick(new Date(NINE.getTime() + 30 * 60_000))).resolves.toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
    await expect(alarm.tick(new Date(NINE.getTime() + 24 * 3_600_000))).resolves.toBe(true);
  });

  it('is silent outside the 09:00 hour, and when nothing has waited that long', async () => {
    const late = watch(3);
    await expect(late.alarm.tick(ELEVEN)).resolves.toBe(false);
    expect(late.count).not.toHaveBeenCalled();
    await expect(watch(0).alarm.tick(NINE)).resolves.toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it('looks at the current time when not told one', async () => {
    await expect(watch(0).alarm.tick()).resolves.toBe(false);
  });

  it('never throws: a failed look must not take hr down', async () => {
    await expect(watch(new Error('db down')).alarm.tick(NINE)).resolves.toBe(false);
  });

  it('looks every 15 minutes without holding the process open', () => {
    const unref = jest.fn();
    const spy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as never);
    watch(0).alarm.onApplicationBootstrap();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 15 * 60_000);
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('counts PENDING punches last written before the cutoff', async () => {
    const count = jest.fn().mockResolvedValue(2);
    const repo = new AttendancePrismaRepository({ attendance: { count } } as unknown as PrismaService);
    const cutoff = new Date('2026-11-17T02:15:00.000Z');
    await expect(repo.countPendingOlderThan(cutoff)).resolves.toBe(2);
    expect(count).toHaveBeenCalledWith({ where: { status: 'PENDING', updatedAt: { lt: cutoff } } });
  });
});

describe('templates that cannot be compared', () => {
  it('bestMatch skips an empty template and one of another length instead of scoring it', () => {
    const probe = [1, 0, 0];
    expect(bestMatch(probe, [[], [0.5, 0.5], [1, 0, 0]])).toEqual({ score: 1, index: 2 });
    expect(bestMatch(probe, [[], [1, 0]])).toEqual({ score: 0, index: -1 });
  });

  it('a template that does not decrypt is no template, and ops hear it once', async () => {
    const good = encryptVector([0.6, 0.8], 'unit-test-face-key');
    const foreign = encryptVector([0.6, 0.8], 'another-key-entirely');
    const findMany = jest.fn().mockResolvedValue([
      { employeeId: 'e1', vector: [], vectorEnc: foreign },
      { employeeId: 'e1', vector: [], vectorEnc: foreign },
      { employeeId: 'e1', vector: [], vectorEnc: good },
    ]);
    const repo = new FaceEmbeddingPrismaRepository(
      { faceEmbedding: { findMany } } as unknown as PrismaService,
      config,
    );
    const rows = await repo.listActiveByEmployee('e1');
    expect(rows.map((r) => r.vector)).toEqual([[], [], [0.6, 0.8]]);
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

describe('the enrolment duplicate check fails closed', () => {
  it('an undecryptable template stops the duplicate check rather than letting the face through', async () => {
    const foreign = encryptVector([0.6, 0.8], 'another-key-entirely');
    const findMany = jest.fn().mockResolvedValue([{ employeeId: 'e2', vector: [], vectorEnc: foreign }]);
    const repo = new FaceEmbeddingPrismaRepository(
      { faceEmbedding: { findMany } } as unknown as PrismaService,
      config,
    );
    await expect(repo.listActiveVectorsExcept('e1')).rejects.toThrow();
  });
});

describe('a local engine with no template it can compare', () => {
  it('could not judge the face: engine unavailable (PENDING), not a mismatch', async () => {
    const verifier = new StubFaceVerifier({ faceMatchThreshold: 0.6 } as never);
    await expect(verifier.verify(Buffer.from('frame'), [[], [1, 2]])).rejects.toThrow(
      FaceEngineUnavailableError,
    );
  });
});

describe('an enrolment answers without the template', () => {
  const row = {
    id: 'f1',
    employeeId: 'e1',
    vector: [],
    vectorEnc: Buffer.from('ciphertext'),
    quality: 0.9,
    sourcePhotoUrl: null,
    active: true,
    createdAt: new Date(),
    neoSyncedAt: null,
  };
  const b64 = Buffer.from('frame').toString('base64');
  const user = { sub: 'u1', role: 'HR' } as never;

  it('drops vector and vectorEnc', () => {
    const view = faceView(row as never) as Record<string, unknown>;
    expect(view).not.toHaveProperty('vector');
    expect(view).not.toHaveProperty('vectorEnc');
    expect(view).toMatchObject({ id: 'f1', quality: 0.9 });
  });

  it('on both enrolment paths', async () => {
    const face = { enroll: jest.fn().mockResolvedValue(row), enrollSelf: jest.fn().mockResolvedValue(row) };
    const self = await new SelfFaceController(face as never).enroll({ images: [b64] } as never, user);
    const admin = await new FaceController(face as never).enroll('e1', { images: [b64] } as never, user);
    for (const answer of [self, admin]) expect(answer).not.toHaveProperty('vectorEnc');
  });
});
