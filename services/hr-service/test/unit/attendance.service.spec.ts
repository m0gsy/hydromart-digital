import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee, FaceEmbedding } from '../../prisma/generated/client';
import { HrConfigService } from '../../src/config/hr-config.service';
import { AttendanceService, FacePunch } from '../../src/application/services/attendance.service';
import {
  AttendanceRepository,
  CheckOutPatch,
  CreateAttendanceInput,
} from '../../src/application/ports/attendance.repository';
import { FaceVerifier } from '../../src/application/ports/face-verifier.port';
import { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';

const user: AuthenticatedUser = { sub: 'auth-1', role: 'DRIVER' as never, phone: '08', depotId: 'd1' };
const punch: FacePunch = { image: Buffer.from('x'), photoUrl: null, live: true };

// 08:10 / 08:30 / 16:10 Asia/Jakarta (UTC+7).
const AT_0810 = new Date('2026-07-24T01:10:00Z');
const AT_0830 = new Date('2026-07-24T01:30:00Z');
const AT_1610 = new Date('2026-07-24T09:10:00Z');

class FakeAtt implements AttendanceRepository {
  row: Attendance | null = null;
  created?: CreateAttendanceInput;
  patched?: CheckOutPatch;
  async findByEmployeeAndDate(): Promise<Attendance | null> {
    return this.row;
  }
  async create(input: CreateAttendanceInput): Promise<Attendance> {
    this.created = input;
    this.row = { id: 'a1', ...input } as unknown as Attendance;
    return this.row;
  }
  async patchCheckOut(_id: string, patch: CheckOutPatch): Promise<Attendance> {
    this.patched = patch;
    return { ...(this.row as Attendance), ...patch };
  }
  async list() {
    return { rows: [], total: 0 };
  }
}

const config = {
  timeZone: 'Asia/Jakarta',
  workStartTime: () => '08:00',
  lateToleranceMinutes: () => 15,
  faceMatchThreshold: 0.62,
} as unknown as HrConfigService;

function make(opts: {
  employee?: Partial<Employee> | null;
  enrolled?: FaceEmbedding[];
  verify?: Awaited<ReturnType<FaceVerifier['verify']>>;
  att?: FakeAtt;
}) {
  const att = opts.att ?? new FakeAtt();
  const faces: FaceEmbeddingRepository = {
    create: async () => ({}) as FaceEmbedding,
    listActiveByEmployee: async () => opts.enrolled ?? [{ vector: [1, 0] } as FaceEmbedding],
    listActiveVectorsExcept: async () => [],
    deactivateForEmployee: async () => {},
  };
  const verifier: FaceVerifier = {
    enroll: async () => ({ vector: [1, 0], quality: 1 }),
    verify: async () => opts.verify ?? { score: 0.9, matched: true, live: true },
  };
  const employees = {
    findByAuthSubjectId: async () =>
      opts.employee === null
        ? null
        : ({ id: 'e1', depotId: 'd1', status: 'ACTIVE', ...opts.employee } as Employee),
  } as unknown as EmployeeRepository;
  return { att, svc: new AttendanceService(att, verifier, faces, employees, config) };
}

describe('AttendanceService', () => {
  it('check-in on time → PRESENT, lateMinutes 0', async () => {
    const { att, svc } = make({});
    await svc.checkIn(user, punch, AT_0810);
    expect(att.created).toMatchObject({ status: 'PRESENT', lateMinutes: 0, checkInScore: 0.9 });
  });

  it('check-in past tolerance → LATE with minutes from scheduled start', async () => {
    const { att, svc } = make({});
    await svc.checkIn(user, punch, AT_0830);
    expect(att.created).toMatchObject({ status: 'LATE', lateMinutes: 30 });
  });

  it('rejects a second check-in the same day', async () => {
    const att = new FakeAtt();
    att.row = { checkInAt: AT_0810 } as Attendance;
    const { svc } = make({ att });
    await expect(svc.checkIn(user, punch, AT_0830)).rejects.toThrow(BadRequestException);
  });

  it('rejects when no face is enrolled', async () => {
    const { svc } = make({ enrolled: [] });
    await expect(svc.checkIn(user, punch, AT_0810)).rejects.toThrow(BadRequestException);
  });

  it('rejects a failed liveness and a non-match', async () => {
    const dead = make({ verify: { score: 0.9, matched: true, live: false } });
    await expect(dead.svc.checkIn(user, punch, AT_0810)).rejects.toThrow(BadRequestException);
    const nomatch = make({ verify: { score: 0.1, matched: false, live: true } });
    await expect(nomatch.svc.checkIn(user, punch, AT_0810)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unlinked or inactive employee', async () => {
    await expect(make({ employee: null }).svc.checkIn(user, punch, AT_0810)).rejects.toThrow(NotFoundException);
    await expect(
      make({ employee: { status: 'RESIGNED' } }).svc.checkIn(user, punch, AT_0810),
    ).rejects.toThrow(ForbiddenException);
  });

  it('check-out computes workingMinutes from check-in', async () => {
    const att = new FakeAtt();
    att.row = { id: 'a1', checkInAt: AT_0810, checkOutAt: null } as Attendance;
    const { svc } = make({ att });
    await svc.checkOut(user, punch, AT_1610); // 8h later
    expect(att.patched).toMatchObject({ workingMinutes: 480 });
  });

  it('check-out before check-in is rejected', async () => {
    const { svc } = make({}); // no row
    await expect(svc.checkOut(user, punch, AT_1610)).rejects.toThrow(BadRequestException);
  });
});
