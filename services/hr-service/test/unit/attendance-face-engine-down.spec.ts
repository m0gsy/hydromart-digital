import {
  BadRequestException,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthenticatedUser, alertServerError } from '@hydromart/platform';

import { Attendance, Employee, FaceEmbedding } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { AttendanceService, FacePunch } from '../../src/application/services/attendance.service';
import { AttendanceRepository } from '../../src/application/ports/attendance.repository';
import {
  FaceEngineUnavailableError,
  FaceNotEnrolledError,
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
  const removed: string[] = [];
  let trail: unknown[] = [];
  let stored: string | null = 'hr/attendance/submitted.jpg';
  let removeFails = false;
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
    listAdjustments: async () => trail,
  } as unknown as AttendanceRepository;
  const verify = jest.fn<Promise<FaceVerifyResult>, unknown[]>();
  const verifier: FaceVerifier = {
    enroll: async () => ({ vector: [], quality: 1 }),
    verify: (...args: unknown[]) => verify(...args),
  };
  const retired: string[] = [];
  let retireFails = false;
  const faces = {
    listActiveByEmployee: async () => [{ vector: [] } as unknown as FaceEmbedding],
    deactivateForEmployee: async (employeeId: string) => {
      if (retireFails) throw new Error('db down');
      retired.push(employeeId);
    },
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
    put: async () => ({ key: stored }),
    remove: async (key: string) => {
      if (removeFails) throw new Error('bucket down');
      removed.push(key);
    },
  } as unknown as StoragePort;
  const svc = new AttendanceService(repo, verifier, faces, employees, config, storage);
  const day = (patch: Partial<Attendance>) => {
    todays = {
      id: 'a1',
      employeeId: 'e1',
      depotId: 'd1',
      checkInAt: new Date('2026-11-18T01:00:00Z'),
      checkInScore: 0.9,
      checkInPhotoUrl: 'hr/attendance/in.jpg',
      checkOutAt: null,
      checkOutScore: null,
      checkOutPhotoUrl: null,
      lateMinutes: 0,
      status: 'PRESENT',
      ...patch,
    } as unknown as Attendance;
  };
  const storageFails = () => {
    stored = null;
  };
  const hrRuled = () => {
    trail = [{ id: 'adj1', approvedBy: 'hr-1', before: { status: 'PENDING' } }];
  };
  const hrCorrected = () => {
    trail = [{ id: 'adj2', approvedBy: 'hr-1', before: { status: 'PRESENT' } }];
  };
  const deviceClockNoted = () => {
    trail = [{ id: 'adj0', approvedBy: null }];
  };
  const bucketDown = () => {
    removeFails = true;
  };
  const retireBroken = () => {
    retireFails = true;
  };
  return { svc, verify, created, checkOuts, statuses, reasons, removed, retired, retireBroken, day, storageFails, hrRuled, hrCorrected, bucketDown, deviceClockNoted };
}

const alert = alertServerError as jest.Mock;

beforeEach(() => alert.mockClear());

describe('check-in while the face engine cannot be asked', () => {
  it('records the punch, held PENDING with no score, instead of refusing it', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(QUOTA);

    const row = await svc.checkIn(user, punch, AT);

    expect(row.status).toBe('PENDING');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: 'PENDING', checkInScore: null });
    // Telling ops is the provider's job (it knows when NEO went down); the service only logs.
    expect(alert).not.toHaveBeenCalled();
  });

  it('stores the image submitted with the punch, never a frame key the client sent along', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(QUOTA);
    await svc.checkIn(user, { ...punch, photoUrl: 'hr/attendance/someone-else.jpg' }, AT);
    expect(created[0]).toMatchObject({ checkInPhotoUrl: 'hr/attendance/submitted.jpg' });
  });

  it('with no frame stored there is nothing for HR to judge: refused for the device to retry', async () => {
    const { svc, verify, created, storageFails } = make();
    storageFails();
    verify.mockRejectedValue(QUOTA);
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(ServiceUnavailableException);
    expect(created).toHaveLength(0);
  });

  it('a frame key the client named is neither kept nor deleted: only the submitted image counts', async () => {
    const { svc, verify, created, removed } = make();
    verify.mockRejectedValue(QUOTA);
    await svc.checkIn(user, { ...punch, photoUrl: 'hr/documents/someone-else.pdf' }, AT);
    expect(created[0]).toMatchObject({ checkInPhotoUrl: 'hr/attendance/submitted.jpg' });
    expect(removed).toEqual([]);
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

  it('a day HR rejected stays rejected', async () => {
    const { svc, verify, statuses, day } = make();
    day({ status: 'ABSENT' });
    verify.mockRejectedValue(QUOTA);
    await svc.checkOut(user, punch, new Date('2026-11-18T10:00:00Z'));
    expect(statuses).toEqual([]);
  });

  it('a day HR already approved from the queue is not pulled back out of payroll', async () => {
    const { svc, verify, statuses, day, hrRuled } = make();
    day({ status: 'PRESENT' });
    hrRuled();
    verify.mockRejectedValue(QUOTA);
    await svc.checkOut(user, punch, new Date('2026-11-18T10:00:00Z'));
    expect(statuses).toEqual([]);
  });

  it('an unrelated correction or a device-clock note does not keep the day from HR', async () => {
    const corrected = make();
    corrected.day({ status: 'PRESENT' });
    corrected.hrCorrected();
    corrected.verify.mockRejectedValue(QUOTA);
    await corrected.svc.checkOut(user, punch, new Date('2026-11-18T10:00:00Z'));
    expect(corrected.statuses).toEqual([['a1', 'PENDING']]);

    const offline = make();
    offline.day({ status: 'PRESENT' });
    offline.deviceClockNoted();
    offline.verify.mockRejectedValue(QUOTA);
    await offline.svc.checkOut(user, punch, new Date('2026-11-18T10:00:00Z'));
    expect(offline.statuses).toEqual([['a1', 'PENDING']]);
  });

  it("HR's decision on such a punch is recorded as an unverified face, not an offline sync", async () => {
    const { svc, reasons, day } = make();
    day({ status: 'PENDING', checkInScore: null, checkInPhotoUrl: 'hr/attendance/f.jpg' });
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
  });

  // 2026-11-21: NEO had dropped faces it verified the day before; each punch was a paging 503.
  it('a face the engine no longer holds is kept PENDING for HR, and the stale enrolment retired', async () => {
    const { svc, verify, created, retired } = make();
    verify.mockRejectedValue(new FaceNotEnrolledError());

    const row = await svc.checkIn(user, punch, AT);

    expect(row.status).toBe('PENDING');
    expect(created[0]).toMatchObject({ status: 'PENDING', checkInScore: null, checkInPhotoUrl: 'hr/attendance/submitted.jpg' });
    // So the app's "enrolled?" read asks for a new enrolment before the next punch.
    expect(retired).toEqual(['e1']);
    expect(alert).not.toHaveBeenCalled();
  });

  it('the same at check-out: the whole day goes in front of HR', async () => {
    const { svc, verify, checkOuts, statuses, day, retired } = make();
    day({});
    verify.mockRejectedValue(new FaceNotEnrolledError());
    const row = await svc.checkOut(user, punch, new Date('2026-11-21T10:00:00Z'));
    expect(checkOuts[0]).toMatchObject({ checkOutScore: null });
    expect(statuses).toEqual([['a1', 'PENDING']]);
    expect(row.status).toBe('PENDING');
    expect(retired).toEqual(['e1']);
  });

  it('keeps the punch even when the stale enrolment cannot be retired', async () => {
    const { svc, verify, created, retireBroken, retired } = make();
    retireBroken();
    verify.mockRejectedValue(new FaceNotEnrolledError());
    await expect(svc.checkIn(user, punch, AT)).resolves.toMatchObject({ status: 'PENDING' });
    expect(created).toHaveLength(1);
    expect(retired).toEqual([]);
  });

  it('a face it could not find is the employee retaking the photo (400), nothing recorded', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(new BadRequestException('Wajah tidak terdeteksi'));
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('a face that does not match is refused (403, never 401: a 401 makes every client re-send), nothing recorded', async () => {
    const { svc, verify, created } = make();
    verify.mockResolvedValue({ score: 0.2, matched: false });
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(ForbiddenException);
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
    day({ status: 'PENDING', checkInScore: 0.88, checkInPhotoUrl: 'hr/attendance/f.jpg' });
    await svc.decide(user, 'a1', 'REJECT');
    expect(reasons).toEqual(['Absen offline: REJECT']);
    // A time HR typed in has neither a score nor a frame: not an unverified face either.
    const typed = make();
    typed.day({ status: 'PENDING', checkInScore: 0.9, checkOutAt: new Date(), checkOutScore: null, checkOutPhotoUrl: null } as never);
    await typed.svc.decide(user, 'a1', 'APPROVE');
    expect(typed.reasons).toEqual(['Absen offline: APPROVE']);
  });
});
