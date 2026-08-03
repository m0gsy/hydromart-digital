import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import {
  Attendance,
  AttendanceStatus,
  Employee,
  FaceEmbedding,
} from '../../prisma/generated/client';
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

const user: AuthenticatedUser = {
  sub: 'auth-1',
  role: 'STAFF_DEPOT' as never,
  phone: '08',
  depotId: 'd1',
};
const punch: FacePunch = {
  image: Buffer.from('x'),
  photoUrl: null,
  lat: -6.2,
  lng: 106.8,
};

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
  async findById(): Promise<Attendance | null> {
    return this.row;
  }
  async upsertManual(): Promise<Attendance> {
    return this.row as Attendance;
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
  async create(input: CreateAttendanceInput): Promise<Attendance> {
    this.created = input;
    this.row = { id: 'a1', ...input } as unknown as Attendance;
    return this.row;
  }
  async patchCheckOut(_id: string, patch: CheckOutPatch): Promise<Attendance> {
    this.patched = patch;
    // Kept on `row` so a later patchStatus sees the checked-out day, as Prisma would.
    this.row = { ...(this.row as Attendance), ...patch };
    return this.row;
  }
  async patchStatus(_id: string, status: AttendanceStatus): Promise<Attendance> {
    this.row = { ...(this.row as Attendance), status };
    return this.row;
  }
  async list() {
    return { rows: [], total: 0 };
  }
}

const config = {
  timeZone: 'Asia/Jakarta',
  workStartTime: () => '08:00',
  lateToleranceMinutes: () => 15,
  geofence: () => ({ lat: null, lng: null, radiusM: 0 }),
  offlineAutoAcceptMinutes: () => 10,
  offlineMaxAgeHours: () => 24,
  faceMatchThreshold: 0.62,
} as unknown as HrConfigService;

function make(
  opts: {
    employee?: Partial<Employee> | null;
    enrolled?: FaceEmbedding[];
    verify?: Awaited<ReturnType<FaceVerifier['verify']>>;
    att?: FakeAtt;
  },
  cfg: HrConfigService = config,
) {
  const att = opts.att ?? new FakeAtt();
  const faces: FaceEmbeddingRepository = {
    create: async () => ({}) as FaceEmbedding,
    listActiveByEmployee: async () => opts.enrolled ?? [{ vector: [1, 0] } as FaceEmbedding],
    listActiveVectorsExcept: async () => [],
    deactivateForEmployee: async () => {},
  };
  const verifier: FaceVerifier = {
    enroll: async () => ({ vector: [1, 0], quality: 1 }),
    verify: async () => opts.verify ?? { score: 0.9, matched: true },
  };
  const employees = {
    findByAuthSubjectId: async () =>
      opts.employee === null
        ? null
        : ({ id: 'e1', depotId: 'd1', status: 'ACTIVE', ...opts.employee } as Employee),
  } as unknown as EmployeeRepository;
  return { att, svc: new AttendanceService(att, verifier, faces, employees, cfg) };
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

  it('rejects a non-match', async () => {
    const nomatch = make({ verify: { score: 0.1, matched: false } });
    await expect(nomatch.svc.checkIn(user, punch, AT_0810)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unlinked or inactive employee', async () => {
    await expect(make({ employee: null }).svc.checkIn(user, punch, AT_0810)).rejects.toThrow(
      NotFoundException,
    );
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

// Asisten SPV and up carry no home depot: they punch at whichever depot they supervise.
// Outside every fenced one is held for HR rather than refused — a supervisor genuinely on
// site at a depot nobody geofenced must not be locked out, and a punch from home must not
// pass unnoticed.
describe('AttendanceService — supervisor with no home depot', () => {
  const FENCE = { lat: -6.2, lng: 106.8, radiusM: 200 };
  const spv: AuthenticatedUser = {
    sub: 'auth-2',
    role: 'SUPERVISOR' as never,
    phone: '08',
    depotId: null as never,
    depotIds: ['d1', 'd2'],
  };
  const farAway: FacePunch = { ...punch, lat: -7.5, lng: 110.4 }; // ~350 km off

  /** Fences only `fencedIds`; every other depot (and the global fallback) stays unset. */
  function withFences(fencedIds: string[]) {
    return {
      ...config,
      geofence: (depotId: string | null = null) =>
        depotId !== null && fencedIds.includes(depotId)
          ? FENCE
          : { lat: null, lng: null, radiusM: 0 },
    } as unknown as HrConfigService;
  }

  function makeSpv(cfg: HrConfigService, att = new FakeAtt()) {
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
      findByAuthSubjectId: async () =>
        ({ id: 'e2', depotId: null, status: 'ACTIVE' }) as unknown as Employee,
    } as unknown as EmployeeRepository;
    return { att, svc: new AttendanceService(att, verifier, faces, employees, cfg) };
  }

  it('inside ANY supervised depot fence counts normally', async () => {
    const { att, svc } = makeSpv(withFences(['d2']));
    await svc.checkIn(spv, punch, AT_0810); // punch sits on d2's fence centre
    expect(att.created).toMatchObject({ status: 'PRESENT', depotId: null });
  });

  it('outside every fenced depot is held PENDING, not refused', async () => {
    const { att, svc } = makeSpv(withFences(['d1', 'd2']));
    await svc.checkIn(spv, farAway, AT_0810);
    expect(att.created).toMatchObject({ status: 'PENDING' });
  });

  it('lateness is still recorded on a held punch, so approval keeps it', async () => {
    const { att, svc } = makeSpv(withFences(['d1']));
    await svc.checkIn(spv, farAway, AT_0830);
    expect(att.created).toMatchObject({ status: 'PENDING', lateMinutes: 30 });
  });

  it('no supervised depot has a fence → nothing to measure, punch passes', async () => {
    const { att, svc } = makeSpv(withFences([]));
    await svc.checkIn(spv, farAway, AT_0810);
    expect(att.created).toMatchObject({ status: 'PRESENT' });
  });

  it('an empty supervised set falls back to the global fence', async () => {
    const { att, svc } = makeSpv(withFences(['d1']));
    await svc.checkIn({ ...spv, depotIds: [] }, farAway, AT_0810);
    expect(att.created).toMatchObject({ status: 'PRESENT' });
  });

  // The guard fills depotIds on every non-public route, but the service must not assume it:
  // an unresolved scope means "no depots to measure against", never "fence everything".
  it('an unresolved scope behaves like an empty one', async () => {
    const { att, svc } = makeSpv(withFences(['d1']));
    await svc.checkIn({ ...spv, depotIds: undefined }, farAway, AT_0810);
    expect(att.created).toMatchObject({ status: 'PRESENT' });
  });

  it('a check-out away from every site puts the whole day in front of HR', async () => {
    const att = new FakeAtt();
    att.row = { id: 'a1', checkInAt: AT_0810, checkOutAt: null, status: 'PRESENT' } as Attendance;
    const { svc } = makeSpv(withFences(['d1']), att);
    const out = await svc.checkOut(spv, farAway, AT_1610);
    expect(out.status).toBe('PENDING');
  });

  it('an on-site check-out leaves the day alone', async () => {
    const att = new FakeAtt();
    att.row = { id: 'a1', checkInAt: AT_0810, checkOutAt: null, status: 'PRESENT' } as Attendance;
    const { svc } = makeSpv(withFences(['d1']), att);
    const out = await svc.checkOut(spv, punch, AT_1610);
    expect(out.status).toBe('PRESENT');
    expect(out.workingMinutes).toBe(480);
  });

  it('a day already PENDING is not re-queued by the check-out', async () => {
    const att = new FakeAtt();
    att.row = { id: 'a1', checkInAt: AT_0810, checkOutAt: null, status: 'PENDING' } as Attendance;
    const { svc } = makeSpv(withFences(['d1']), att);
    const out = await svc.checkOut(spv, farAway, AT_1610);
    expect(out.status).toBe('PENDING');
    expect(out.workingMinutes).toBe(480);
  });

  it('a depot-locked employee is still refused outright, never held', async () => {
    const { svc } = make({}, withFences(['d1']));
    await expect(svc.checkIn(user, farAway, AT_0810)).rejects.toThrow(ForbiddenException);
  });
});
