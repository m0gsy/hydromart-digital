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
import { FaceVerifier, FaceVerifyResult } from '../../src/application/ports/face-verifier.port';
import { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';

/**
 * 2026-11-18: the NEO face quota ran out at 14:31 WIB and every check-in after it was a 503 —
 * nobody's attendance recorded for the rest of the day, and Discord paged on each one. The
 * owner's rule since: when the face engine cannot answer, the punch is RECORDED, held PENDING
 * with no score, and HR decides from the photo. Ops hear about it once, not on every punch.
 */
jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  alertServerError: jest.fn(),
}));

const user: AuthenticatedUser = { sub: 'auth-1', role: 'STAFF_DEPOT' as never, phone: '08', depotId: 'd1' };
const punch: FacePunch = { image: Buffer.from('x'), photoUrl: null, lat: -6.2, lng: 106.8 };
const AT = new Date('2026-11-18T01:10:00Z'); // 08:10 WIB, on time
const QUOTA = new ServiceUnavailableException(
  'Face engine (NEO) gagal: verify-face: Not authorized: max api hit limit reached!',
);

function make() {
  const created: Partial<Attendance>[] = [];
  const checkOuts: Record<string, unknown>[] = [];
  const statuses: [string, string][] = [];
  let todays: Attendance | null = null;
  const repo = {
    findByEmployeeAndDate: async () => todays,
    findRecent: async () => [],
    listRecentByEmployee: async () => [],
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
  const svc = new AttendanceService(repo, verifier, faces, employees, config);
  const openDay = () => {
    todays = {
      id: 'a1',
      employeeId: 'e1',
      depotId: 'd1',
      checkInAt: new Date('2026-11-18T01:00:00Z'),
      checkOutAt: null,
      status: 'PRESENT',
    } as unknown as Attendance;
  };
  return { svc, verify, created, checkOuts, statuses, openDay };
}

const alert = alertServerError as jest.Mock;

beforeEach(() => alert.mockClear());

describe('check-in while the face engine cannot answer', () => {
  it('records the punch, held PENDING with no score, instead of refusing it', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(QUOTA);

    const row = await svc.checkIn(user, punch, AT);

    expect(row.status).toBe('PENDING');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: 'PENDING', checkInScore: null });
  });

  it('tells ops once when the engine goes down, and again only after it came back', async () => {
    const { svc, verify } = make();
    verify.mockRejectedValue(QUOTA);
    await svc.checkIn(user, punch, AT);
    await svc.checkIn(user, punch, AT);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(alert.mock.calls[0]?.[0]?.exception)).toMatch(/PENDING/);

    verify.mockResolvedValueOnce({ score: 0.9, matched: true });
    await svc.checkIn(user, punch, AT);
    verify.mockRejectedValue(QUOTA);
    await svc.checkIn(user, punch, AT);
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it('a check-out while it is down puts the whole day in front of HR', async () => {
    const { svc, verify, checkOuts, statuses, openDay } = make();
    openDay();
    verify.mockRejectedValue(QUOTA);

    const row = await svc.checkOut(user, punch, new Date('2026-11-18T10:00:00Z'));

    expect(checkOuts[0]).toMatchObject({ checkOutScore: null });
    expect(statuses).toEqual([['a1', 'PENDING']]);
    expect(row.status).toBe('PENDING');
  });
});

describe('what the engine DID answer still decides', () => {
  it('a face it could not find is the employee retaking the photo (400), nothing recorded', async () => {
    const { svc, verify, created } = make();
    verify.mockRejectedValue(new BadRequestException('Wajah tidak terdeteksi'));
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(BadRequestException);
    expect(created).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a face that does not match is refused (401), nothing recorded', async () => {
    const { svc, verify, created } = make();
    verify.mockResolvedValue({ score: 0.2, matched: false });
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(UnauthorizedException);
    expect(created).toHaveLength(0);
  });

  it('a matched face on time is PRESENT with its score, as before', async () => {
    const { svc, verify, created } = make();
    verify.mockResolvedValue({ score: 0.93, matched: true });
    const row = await svc.checkIn(user, punch, AT);
    expect(row.status).toBe('PRESENT');
    expect(created[0]).toMatchObject({ checkInScore: 0.93 });
  });
});
