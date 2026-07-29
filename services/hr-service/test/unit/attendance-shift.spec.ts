import { AuthenticatedUser } from '@hydromart/platform';

import {
  Attendance,
  Employee,
  FaceEmbedding,
  Shift,
  ShiftAssignment,
  ShiftRotation,
} from '../../prisma/generated/client';
import {
  AttendanceRepository,
  CreateAttendanceInput,
} from '../../src/application/ports/attendance.repository';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { FaceEmbeddingRepository } from '../../src/application/ports/face-embedding.repository';
import { FaceVerifier } from '../../src/application/ports/face-verifier.port';
import { ShiftRepository } from '../../src/application/ports/shift.repository';
import { AttendanceService } from '../../src/application/services/attendance.service';
import { HrConfigService } from '../../src/config/hr-config.service';

const user: AuthenticatedUser = { sub: 'u1', role: 'DRIVER' as never, phone: '08', depotId: 'd1' };
const punch = { image: Buffer.from('x'), photoUrl: null, live: true, lat: 0, lng: 0 };

/** 2026-08-03 is a Monday. 08:10 Jakarta = 01:10 UTC. */
const MONDAY_0810 = new Date('2026-08-03T01:10:00.000Z');

const shift = (id: string, startTime: string): Shift =>
  ({ id, startTime, endTime: '16:00', active: true, depotId: null }) as Shift;

class FakeAtt implements Partial<AttendanceRepository> {
  created?: CreateAttendanceInput;
  async findByEmployeeAndDate(): Promise<Attendance | null> {
    return null;
  }
  async create(input: CreateAttendanceInput): Promise<Attendance> {
    this.created = input;
    return { id: 'a1', ...input } as unknown as Attendance;
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

function make(opts: {
  employee?: Partial<Employee>;
  shifts?: Shift[];
  depotShift?: Shift | null;
  assignments?: Partial<ShiftAssignment>[];
  rotation?: Partial<ShiftRotation> | null;
  noShiftRepo?: boolean;
}) {
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
    findByAuthSubjectId: async () =>
      ({ id: 'e1', depotId: 'd1', status: 'ACTIVE', shiftId: null, ...opts.employee }) as Employee,
  } as unknown as EmployeeRepository;

  const catalogue = opts.shifts ?? [];
  const shifts = opts.noShiftRepo
    ? undefined
    : ({
        findById: jest.fn(async (id: string) => catalogue.find((s) => s.id === id) ?? null),
        findActiveForDepot: jest.fn(async () => opts.depotShift ?? null),
        findRotationById: jest.fn(async () => (opts.rotation ?? null) as ShiftRotation | null),
        listAssignmentsUpTo: jest.fn(async (_e: string, onDate: Date) =>
          (opts.assignments ?? [])
            .map((a) => a as ShiftAssignment)
            .filter((a) => a.effectiveFrom.getTime() <= onDate.getTime()),
        ),
      } as unknown as ShiftRepository);

  return {
    att,
    shifts,
    svc: new AttendanceService(att as never, verifier, faces, employees, config, undefined, shifts),
  };
}

describe('AttendanceService late-calc against the employee’s shift (C3)', () => {
  it('ZERO REGRESSION: without an assignment or a shiftId, the depot shift still decides', async () => {
    const { att } = make({ depotShift: shift('depot', '09:00') });
    const late = make({ depotShift: shift('depot', '07:00') });
    await late.svc.checkIn(user, punch, MONDAY_0810);
    // 08:10 against a 07:00 depot shift + 15 min tolerance → late by 70 minutes, as before.
    expect(late.att.created).toMatchObject({ status: 'LATE', lateMinutes: 70 });
    expect(att.created).toBeUndefined();
  });

  it('ZERO REGRESSION: with no shift repository at all it falls to the configured start', async () => {
    const { att, svc } = make({ noShiftRepo: true });
    await svc.checkIn(user, punch, MONDAY_0810);
    // 08:10 against the 08:00 config start + 15 min tolerance → on time.
    expect(att.created).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
  });

  it('reads Employee.shiftId, which the service ignored before this milestone', async () => {
    const { att, svc } = make({
      employee: { shiftId: 'own' },
      shifts: [shift('own', '07:00')],
      depotShift: shift('depot', '09:00'),
    });
    await svc.checkIn(user, punch, MONDAY_0810);
    // The depot's 09:00 would have made this on time; their own 07:00 makes it late.
    expect(att.created).toMatchObject({ status: 'LATE', lateMinutes: 70 });
  });

  it('an assignment beats both the employee’s shiftId and the depot shift', async () => {
    const { att, svc } = make({
      employee: { shiftId: 'own' },
      shifts: [shift('own', '07:00'), shift('assigned', '10:00')],
      depotShift: shift('depot', '06:00'),
      assignments: [
        {
          shiftId: 'assigned',
          rotationId: null,
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });
    await svc.checkIn(user, punch, MONDAY_0810);
    expect(att.created).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
  });

  it('a rotation picks the shift for that weekday', async () => {
    const { att, svc } = make({
      shifts: [shift('pagi', '07:00'), shift('siang', '13:00')],
      depotShift: shift('depot', '08:00'),
      rotation: { id: 'r1', pattern: { '1': 'pagi', '2': 'siang' } },
      assignments: [
        { shiftId: null, rotationId: 'r1', effectiveFrom: new Date('2026-08-01T00:00:00.000Z') },
      ],
    });
    // Monday → 'pagi' at 07:00, so 08:10 is 70 minutes late.
    await svc.checkIn(user, punch, MONDAY_0810);
    expect(att.created).toMatchObject({ status: 'LATE', lateMinutes: 70 });
  });

  it('a weekday missing from the rotation falls back rather than inventing a shift', async () => {
    const { att, svc } = make({
      shifts: [shift('pagi', '07:00')],
      depotShift: shift('depot', '09:00'),
      rotation: { id: 'r1', pattern: { '2': 'pagi' } }, // Tuesday only
      assignments: [
        { shiftId: null, rotationId: 'r1', effectiveFrom: new Date('2026-08-01T00:00:00.000Z') },
      ],
    });
    await svc.checkIn(user, punch, MONDAY_0810);
    // Monday is a day off in the pattern → depot shift 09:00 → on time.
    expect(att.created).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
  });

  it('an assignment that has not started yet does not apply', async () => {
    const { att, svc } = make({
      shifts: [shift('future', '06:00')],
      depotShift: shift('depot', '09:00'),
      assignments: [
        {
          shiftId: 'future',
          rotationId: null,
          effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });
    await svc.checkIn(user, punch, MONDAY_0810);
    expect(att.created).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
  });

  it('an assignment pointing at a deleted shift falls back instead of failing the punch', async () => {
    const { att, svc } = make({
      shifts: [],
      depotShift: shift('depot', '09:00'),
      assignments: [
        { shiftId: 'gone', rotationId: null, effectiveFrom: new Date('2026-08-01T00:00:00.000Z') },
      ],
    });
    await svc.checkIn(user, punch, MONDAY_0810);
    expect(att.created).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
  });
});
