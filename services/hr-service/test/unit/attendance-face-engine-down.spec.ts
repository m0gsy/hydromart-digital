import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedUser, alertServerError } from '@hydromart/platform';

import { Attendance, Employee, FaceEmbedding } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { AttendanceService, FacePunch } from '../../src/application/services/attendance.service';
import { AttendanceRepository } from '../../src/application/ports/attendance.repository';
import {
  FaceEngineUnavailableError,
  FaceVerifier,
  FaceVerifyResult,
} from '../../src/application/ports/face-verifier.port';
import { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { StoragePort } from '../../src/application/ports/storage.port';

/**
 * 2026-11-18: the NEO face quota ran out at 14:31 WIB and every check-in after it was a 503 —
 * nobody's attendance recorded for the rest of the day, and Discord paged on each one. The
 * owner's rule since: when the face engine cannot be ASKED, the punch is RECORDED, held PENDING
 * with no score, and HR decides from the frame. Review of #927 bounded it: only the engine
 * being unreachable qualifies (never a bad frame or a misconfiguration), the frame is the image
 * submitted, a day HR already ruled on stays ruled, and a dead engine is not waited on per punch.
 */
jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  alertServerError: jest.fn(),
}));

const user: AuthenticatedUser = { sub: 'auth-1', role: 'STAFF_DEPOT' as never, phone: '08', depotId: 'd1' };
const punch: FacePunch = { image: Buffer.from('x'), photoUrl: null, lat: -6.2, lng: 106.8 };
const AT = new Date('2026-11-18T01:10:00Z'); // 08:10 WIB, on time
const QUOTA = new FaceEngineUnavailableError(
  'Face engine (NEO) gagal: verify-face: Not authorized: max api hit limit reached!',
);

function make() {
  const created: Partial<Attendance>[] = [];
  const checkOuts: Record<string, unknown>[] = [];
  const statuses: [string, string][] = [];
  const reasons: string[] = [];
  let todays: Attendance | null = null;
  const repo = {
    findByEmployeeAndDate: async () => todays,
    findById: async () => todays,
    create: async (data: Partial<Attendance>) => {
      created.push(data);
      return { id: 'a-new', ...data } as Attendance;
    },
    patchCheckOut: async (id: string, data: Record<string, unknown>) => {
      checkOuts.push(data);
      return { ...(todays as Attendance), ...data, id } as Attendance;
    },
    patchStatus: async (id: string, status: string) => {
      statuses.push([id, status]);
      return { ...(todays as Attendance), id, status } as Attendance;
    },
    recordAdjustment: async (entry: { reason: string }) => {
      reasons.push(entry.reason);
    },
  } as unknown as AttendanceRepository;
  const verify = jest.fn<Promise<FaceVerifyResult>, unknown[]>();
  const verifier: FaceVerifier = {
    enroll: async () => ({ vector: [], quality: 1 }),
    verify: (...args: unknown[]) => verify(...args),
  };
  const faces = {
    listActiveByEmployee: async () => [{ vector: [] } as unknown as FaceEmbedding],
  } as unknown as FaceEmbeddingRepository;
  const employees = {
    findByAuthSubjectId: async () =>
      ({ id: 'e1', depotId: 'd1', status: 'ACTIVE', fullName: 'Budi' }) as Employee,
  } as unknown as EmployeeRepository;
  const config = {
    timeZone: 'Asia/Jakarta',
    depotAssignmentEnabled: false,
    workStartTime: () => '08:00',
    lateToleranceMinutes: () => 15,
    offlineAutoAcceptMinutes: () => 10,
    offlineMaxAgeHours: () => 72,
    geofence: () => ({ lat: null, lng: null, radiusM: 0 }),
  } as unknown as HrConfigService;
  const storage = {
    put: async () => ({ key: 'hr/attendance/submitted.jpg' }),
    remove: async () => undefined,
  } as unknown as StoragePort;
  const svc = new AttendanceService(repo, verifier, faces, employees, config, storage);
  const day = (patch: Partial<Attendance>) => {
    todays = {
      id: 'a1',
      employeeId: 'e1',
      depotId: 'd1',
      checkInAt: new Date('2026-11-18T01:00:00Z'),
      checkInScore: 0.9,
      checkOutAt: null,
      checkOutScore: null,
      lateMinutes: 0,
      status: 'PRESENT',
      ...patch,
    } as unknown as Attendance;
  };
  return { svc, verify, created, checkOuts, statuses, reasons, day };
}

const alert = alertServerError as jest.Mock;

beforeEach(() => {
  alert.mockClear();
  jest.useFakeTimers({ now: new Date('2026-11-18T01:10:00Z') });
});
afterEach(() => jest.useRealTimers());

describe('check-in while the face engine cannot be asked', () => {
  it('records the punch, held PENDING with no score, instead of refusing it', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(QUOTA);

    const row = await svc.checkIn(user, punch, AT);

    expect(row.status).toBe('PENDING');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: 'PENDING', checkInScore: null });
  });

  it('stores the image submitted with the punch, never a frame key the client sent along', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(QUOTA);
    await svc.checkIn(user, { ...punch, photoUrl: 'hr/attendance/someone-else.jpg' }, AT);
    expect(created[0]).toMatchObject({ checkInPhotoUrl: 'hr/attendance/submitted.jpg' });
  });

  it('tells ops once per outage, does not wait on a dead engine per punch, and re-arms after it answers', async () => {
    const { svc, verify } = make();
    verify.mockRejectedValue(QUOTA);
    await svc.checkIn(user, punch, AT);
    await svc.checkIn(user, punch, AT); // inside the minute: held without asking again
    expect(verify).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(alert.mock.calls[0]?.[0]?.exception)).toMatch(/PENDING/);

    jest.advanceTimersByTime(61_000);
    await svc.checkIn(user, punch, AT); // asked again, still down: no second alert
    expect(verify).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(61_000);
    verify.mockResolvedValueOnce({ score: 0.9, matched: true });
    await svc.checkIn(user, punch, AT); // back up
    verify.mockRejectedValue(QUOTA);
    await svc.checkIn(user, punch, AT); // a new outage: a new alert
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it('an engine that answered at all, even with a retake, counts as up again', async () => {
    const { svc, verify } = make();
    verify.mockRejectedValueOnce(QUOTA);
    await svc.checkIn(user, punch, AT);
    jest.advanceTimersByTime(61_000);
    verify.mockRejectedValueOnce(new BadRequestException('Wajah tidak terdeteksi'));
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(BadRequestException);
    // Not inside a breaker window any more: the very next punch is asked.
    verify.mockResolvedValueOnce({ score: 0.9, matched: true });
    await svc.checkIn(user, punch, AT);
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it('a check-out it cannot judge puts the whole day in front of HR', async () => {
    const { svc, verify, checkOuts, statuses, day } = make();
    day({});
    verify.mockRejectedValue(QUOTA);

    const row = await svc.checkOut(user, punch, new Date('2026-11-18T10:00:00Z'));

    expect(checkOuts[0]).toMatchObject({ checkOutScore: null });
    expect(statuses).toEqual([['a1', 'PENDING']]);
    expect(row.status).toBe('PENDING');
  });

  it('a day HR already rejected stays rejected', async () => {
    const { svc, verify, statuses, day } = make();
    day({ status: 'ABSENT' });
    verify.mockRejectedValue(QUOTA);
    await svc.checkOut(user, punch, new Date('2026-11-18T10:00:00Z'));
    expect(statuses).toEqual([]);
  });

  it("HR's decision on such a punch is recorded as an unverified face, not an offline sync", async () => {
    const { svc, reasons, day } = make();
    day({ status: 'PENDING', checkInScore: null });
    await svc.decide(user, 'a1', 'APPROVE');
    expect(reasons).toEqual(['Wajah belum diverifikasi: APPROVE']);
  });
});

describe('what is not the engine being down still decides', () => {
  it('a misconfiguration (plain 503) is refused loudly, nothing recorded', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(new ServiceUnavailableException('NEO_FR_TOKEN belum diset'));
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(ServiceUnavailableException);
    expect(created).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a face it could not find is the employee retaking the photo (400), nothing recorded', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(new BadRequestException('Wajah tidak terdeteksi'));
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('a face that does not match is refused (401), nothing recorded', async () => {
    const { svc, verify, created } = make();
    verify.mockResolvedValue({ score: 0.2, matched: false });
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(UnauthorizedException);
    expect(created).toHaveLength(0);
  });

  it('a matched face on time is PRESENT with its score and the client frame, as before', async () => {
    const { svc, verify, created } = make();
    verify.mockResolvedValue({ score: 0.93, matched: true });
    const row = await svc.checkIn(user, { ...punch, photoUrl: 'hr/attendance/client.jpg' }, AT);
    expect(row.status).toBe('PRESENT');
    expect(created[0]).toMatchObject({ checkInScore: 0.93, checkInPhotoUrl: 'hr/attendance/client.jpg' });
  });

  it('an ordinary offline approval keeps its old wording', async () => {
    const { svc, reasons, day } = make();
    day({ status: 'PENDING', checkInScore: 0.88 });
    await svc.decide(user, 'a1', 'REJECT');
    expect(reasons).toEqual(['Absen offline: REJECT']);
  });
});
