import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee, FaceEmbedding } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { AttendanceService, FacePunch } from '../../src/application/services/attendance.service';
import {
  AttendanceRepository,
  AttendanceListFilter,
} from '../../src/application/ports/attendance.repository';
import { FaceVerifier } from '../../src/application/ports/face-verifier.port';
import { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';

const user: AuthenticatedUser = {
  sub: 'auth-1',
  role: 'DRIVER' as never,
  phone: '08',
  depotId: 'd1',
};
const manager: AuthenticatedUser = {
  sub: 'mgr',
  role: 'DEPOT_MANAGER' as never,
  phone: '08',
  depotId: 'd1',
};
const punch: FacePunch = {
  image: Buffer.from('x'),
  photoUrl: null,
  live: true,
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
    return { presentDays: 0, lateDays: 0, leaveDays: 0 };
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
  async list(filter: AttendanceListFilter) {
    this.lastFilter = filter;
    return { rows: [{ id: 'a1' } as Attendance], total: 1 };
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
    verify: async () => ({ score: 0.9, matched: true, live: true }),
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

  it('scopes the attendance list to a manager’s own depot', async () => {
    const { att, svc } = make({ lat: null, lng: null, radiusM: 0 });
    const out = await svc.list(manager, {
      from: '2026-07-01',
      to: '2026-07-31',
      page: 2,
      pageSize: 10,
    });
    expect(att.lastFilter).toMatchObject({ depotId: 'd1', skip: 10, take: 10 });
    expect(att.lastFilter?.from).toEqual(new Date('2026-07-01'));
    expect(out).toMatchObject({ total: 1, page: 2, pageSize: 10 });
  });
});
