import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee, FaceEmbedding } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { AttendanceService, FacePunch } from '../../src/application/services/attendance.service';
import {
  AttendanceRepository,
  AttendanceListFilter,
  AttendanceListRow,
} from '../../src/application/ports/attendance.repository';
import { FaceVerifier } from '../../src/application/ports/face-verifier.port';
import { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';

const user: AuthenticatedUser = {
  sub: 'auth-1',
  role: 'STAFF_DEPOT' as never,
  phone: '08',
  depotId: 'd1',
};
const manager: AuthenticatedUser = {
  sub: 'mgr',
  role: 'MANAGER' as never,
  phone: '08',
  depotId: 'd1',
};
const punch: FacePunch = {
  image: Buffer.from('x'),
  photoUrl: null,
  lat: -6.2,
  lng: 106.8,
};
const AT = new Date('2026-07-24T01:10:00Z');

class FakeAtt implements AttendanceRepository {
  lastFilter?: AttendanceListFilter;
  async findByEmployeeAndDate(): Promise<Attendance | null> {
    return null;
  }
  async findById(): Promise<Attendance | null> {
    return null;
  }
  async upsertManual(): Promise<Attendance> {
    return {} as Attendance;
  }
  async recordAdjustment(): Promise<void> {
    return undefined;
  }
  async summary() {
    return { presentDays: 0, lateDays: 0, leaveDays: 0, pendingDays: 0 };
  }
  async summaryMany() {
    return new Map();
  }
  async listWorkedMinutes() {
    return [];
  }
  async create(): Promise<Attendance> {
    return {} as Attendance;
  }
  async patchCheckOut(): Promise<Attendance> {
    return {} as Attendance;
  }
  async patchStatus(): Promise<Attendance> {
    return {} as Attendance;
  }
  async list(filter: AttendanceListFilter) {
    this.lastFilter = filter;
    // CA-1-01: the list row carries the employee's name now — the approval queue was
    // asking somebody to decide on a working day without saying whose it was.
    return { rows: [{ id: 'a1', employeeName: 'Budi' } as AttendanceListRow], total: 1 };
  }
}

function make(geofence: { lat: number | null; lng: number | null; radiusM: number }) {
  const att = new FakeAtt();
  const faces: FaceEmbeddingRepository = {
    create: async () => ({}) as FaceEmbedding,
    listActiveByEmployee: async () => [{ vector: [1, 0] } as FaceEmbedding],
    listActiveVectorsExcept: async () => [],
    deactivateForEmployee: async () => {},
  };
  const verifier: FaceVerifier = {
    enroll: async () => ({ vector: [1, 0], quality: 1 }),
    verify: async () => ({ score: 0.9, matched: true }),
  };
  const employees = {
    findByAuthSubjectId: async () => ({ id: 'e1', depotId: 'd1', status: 'ACTIVE' }) as Employee,
  } as unknown as EmployeeRepository;
  const config = {
    timeZone: 'Asia/Jakarta',
    workStartTime: () => '08:00',
    lateToleranceMinutes: () => 15,
    geofence: () => geofence,
  } as unknown as HrConfigService;
  return { att, svc: new AttendanceService(att, verifier, faces, employees, config) };
}

describe('AttendanceService geofence + list', () => {
  it('rejects a punch outside the depot geofence', async () => {
    const { svc } = make({ lat: 0, lng: 0, radiusM: 100 }); // punch is thousands of km away
    await expect(svc.checkIn(user, punch, AT)).rejects.toThrow(ForbiddenException);
  });

  it('allows a punch when the geofence is disabled (no centre)', async () => {
    const { att, svc } = make({ lat: null, lng: null, radiusM: 0 });
    await svc.checkIn(user, punch, AT);
    expect(att).toBeDefined();
  });

  // An unfiltered list is what both consoles open with: no window at all, and the self-service
  // PWA reading only its own log.
  it('lists without a date window, for staff and for the caller themselves', async () => {
    const { att, svc } = make({ lat: null, lng: null, radiusM: 0 });
    await svc.list(manager, { page: 1, pageSize: 20 });
    expect(att.lastFilter).toMatchObject({ from: undefined, to: undefined });
    await svc.listSelf(user, { page: 1, pageSize: 20 });
    expect(att.lastFilter).toMatchObject({ employeeId: 'e1', from: undefined, to: undefined });
    const from = '2026-07-01';
    const to = '2026-07-31';
    await svc.listSelf(user, { from, to, page: 1, pageSize: 20 });
    expect(att.lastFilter?.from).toEqual(new Date(from));
    expect(att.lastFilter?.to).toEqual(new Date(to));
  });

  // Both punches default `now` to the server clock; only the specs that freeze time pass it.
  it('punches in and out on the server clock when no time is supplied', async () => {
    const { att, svc } = make({ lat: null, lng: null, radiusM: 0 });
    await svc.checkIn(user, punch);
    jest
      .spyOn(att, 'findByEmployeeAndDate')
      .mockResolvedValue({ id: 'a1', checkInAt: new Date(), checkOutAt: null } as Attendance);
    await expect(svc.checkOut(user, punch)).resolves.toBeDefined();
  });

  it('refuses a second check-out on the same day', async () => {
    const { att, svc } = make({ lat: null, lng: null, radiusM: 0 });
    jest.spyOn(att, 'findByEmployeeAndDate').mockResolvedValue({
      id: 'a1',
      checkInAt: new Date(),
      checkOutAt: new Date(),
    } as Attendance);
    await expect(svc.checkOut(user, punch, AT)).rejects.toThrow(/Sudah check-out/);
  });

  it('scopes the attendance list to a manager’s own depot', async () => {
    const { att, svc } = make({ lat: null, lng: null, radiusM: 0 });
    const out = await svc.list(manager, {
      from: '2026-07-01',
      to: '2026-07-31',
      page: 2,
      pageSize: 10,
    });
    expect(att.lastFilter).toMatchObject({ depotIds: ['d1'], skip: 10, take: 10 });
    expect(att.lastFilter?.from).toEqual(new Date('2026-07-01'));
    expect(out).toMatchObject({ total: 1, page: 2, pageSize: 10 });
  });
});
