import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

const user: AuthenticatedUser = { sub: 'auth-1', role: 'STAFF_DEPOT' as never, phone: '08', depotId: 'd1' };
const hr: AuthenticatedUser = { sub: 'hr-1', role: 'HR' as never, phone: '08', depotId: null };

// 08:10 / 08:30 / 16:10 Asia/Jakarta (UTC+7).
const AT_0810 = new Date('2026-07-24T01:10:00Z');
const AT_0830 = new Date('2026-07-24T01:30:00Z');
const AT_1610 = new Date('2026-07-24T09:10:00Z');

function punchAt(capturedAt?: Date): FacePunch {
  return {
    image: Buffer.from('x'),
    photoUrl: null,
    live: true,
    lat: -6.2,
    lng: 106.8,
    capturedAt: capturedAt ?? null,
  };
}

class FakeAtt implements AttendanceRepository {
  row: Attendance | null = null;
  created?: CreateAttendanceInput;
  patched?: CheckOutPatch;
  statusPatch?: AttendanceStatus;
  adjustments: { reason: string; approvedBy: string | null; after: unknown }[] = [];
  async findByEmployeeAndDate(): Promise<Attendance | null> {
    return this.row;
  }
  async findById(): Promise<Attendance | null> {
    return this.row;
  }
  async upsertManual(): Promise<Attendance> {
    return this.row as Attendance;
  }
  async recordAdjustment(data: {
    reason: string;
    approvedBy: string | null;
    after: unknown;
  }): Promise<void> {
    this.adjustments.push(data);
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
    return { ...(this.row as Attendance), ...patch };
  }
  async patchStatus(_id: string, status: AttendanceStatus): Promise<Attendance> {
    this.statusPatch = status;
    this.row = { ...(this.row as Attendance), status };
    return this.row;
  }
  async list() {
    return { rows: [], total: 0 };
  }
}

function make(
  opts: {
    att?: FakeAtt;
    autoAcceptMinutes?: number;
    maxAgeHours?: number;
    storage?: { put: () => Promise<{ url: string; key: string }> };
  } = {},
) {
  const att = opts.att ?? new FakeAtt();
  const config = {
    timeZone: 'Asia/Jakarta',
    workStartTime: () => '08:00',
    lateToleranceMinutes: () => 15,
    geofence: () => ({ lat: null, lng: null, radiusM: 0 }),
    offlineAutoAcceptMinutes: () => opts.autoAcceptMinutes ?? 10,
    offlineMaxAgeHours: () => opts.maxAgeHours ?? 24,
  } as unknown as HrConfigService;
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
    findById: async () => ({ id: 'e1', depotId: 'd1', status: 'ACTIVE' }) as Employee,
  } as unknown as EmployeeRepository;
  return {
    att,
    svc: new AttendanceService(att, verifier, faces, employees, config, opts.storage as never),
  };
}

describe('AttendanceService offline punch', () => {
  it('keeps a live punch (no capturedAt) on the server clock', async () => {
    const { att, svc } = make();
    await svc.checkIn(user, punchAt(), AT_0810);
    expect(att.created).toMatchObject({ status: 'PRESENT', checkInAt: AT_0810, lateMinutes: 0 });
  });

  it('records device time and stays PRESENT when it synced inside the auto-accept window', async () => {
    const { att, svc } = make();
    // Captured 08:10, flushed 08:15 — five minutes late, well inside the 10-minute window.
    await svc.checkIn(user, punchAt(AT_0810), new Date(AT_0810.getTime() + 5 * 60_000));
    expect(att.created).toMatchObject({ status: 'PRESENT', checkInAt: AT_0810 });
  });

  it('marks a late-synced punch PENDING but keeps the device-time lateness', async () => {
    const { att, svc } = make();
    // Captured 08:30 (30 min late), flushed two hours later.
    await svc.checkIn(user, punchAt(AT_0830), new Date(AT_0830.getTime() + 2 * 3_600_000));
    expect(att.created).toMatchObject({
      status: 'PENDING',
      lateMinutes: 30,
      checkInAt: AT_0830,
    });
  });

  it('treats every offline punch as PENDING when auto-accept is switched off', async () => {
    const { att, svc } = make({ autoAcceptMinutes: 0 });
    await svc.checkIn(user, punchAt(AT_0810), new Date(AT_0810.getTime() + 1_000));
    expect(att.created).toMatchObject({ status: 'PENDING' });
  });

  it('clamps a device clock running ahead back to server time', async () => {
    const { att, svc } = make();
    const future = new Date(AT_0810.getTime() + 6 * 3_600_000);
    await svc.checkIn(user, punchAt(future), AT_0810);
    expect(att.created?.checkInAt).toEqual(AT_0810);
    expect(att.created?.status).toBe('PRESENT');
  });

  it('rejects a punch older than the offline age limit', async () => {
    const { svc } = make({ maxAgeHours: 24 });
    const threeDaysLater = new Date(AT_0810.getTime() + 72 * 3_600_000);
    await expect(svc.checkIn(user, punchAt(AT_0810), threeDaysLater)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('floors an offline check-out at check-in so it cannot shorten below zero', async () => {
    const att = new FakeAtt();
    att.row = { id: 'a1', checkInAt: AT_1610, status: 'PRESENT' } as Attendance;
    const { svc } = make({ att });
    // Device claims 08:10, hours before the recorded check-in.
    await svc.checkOut(user, punchAt(AT_0810), new Date(AT_1610.getTime() + 60_000));
    expect(att.patched?.checkOutAt).toEqual(AT_1610);
    expect(att.patched?.workingMinutes).toBe(0);
  });

  it('never turns a check-out into PENDING', async () => {
    const att = new FakeAtt();
    att.row = { id: 'a1', checkInAt: AT_0810, status: 'PRESENT' } as Attendance;
    const { svc } = make({ att });
    await svc.checkOut(user, punchAt(AT_1610), new Date(AT_1610.getTime() + 5 * 3_600_000));
    expect(att.statusPatch).toBeUndefined();
    expect(att.patched?.checkOutAt).toEqual(AT_1610);
    expect(att.patched?.workingMinutes).toBe(480);
  });
});

describe('AttendanceService photo storage', () => {
  it('records the punch even when the photo bucket is broken', async () => {
    const { att, svc } = make({
      storage: {
        put: async () => {
          throw new Error('No value provided for input HTTP label: Bucket');
        },
      },
    });

    await svc.checkIn(user, punchAt(), AT_0810);

    // The day is still marked present; only the evidence photo is missing.
    expect(att.created).toMatchObject({ status: 'PRESENT', checkInPhotoUrl: null });
  });

  it('stores the returned url when the bucket is healthy', async () => {
    const { att, svc } = make({
      storage: { put: async () => ({ url: 'https://cdn/hr/attendance/a.jpg', key: 'a.jpg' }) },
    });

    await svc.checkIn(user, punchAt(), AT_0810);

    expect(att.created?.checkInPhotoUrl).toBe('https://cdn/hr/attendance/a.jpg');
  });
});

describe('AttendanceService.decide', () => {
  function pending(lateMinutes = 0): FakeAtt {
    const att = new FakeAtt();
    att.row = {
      id: 'a1',
      depotId: 'd1',
      status: 'PENDING',
      lateMinutes,
      checkInAt: AT_0830,
      checkOutAt: null,
    } as Attendance;
    return att;
  }

  it('approves an on-time punch to PRESENT and writes the audit row', async () => {
    const att = pending(0);
    const { svc } = make({ att });
    await svc.decide(hr, 'a1', 'APPROVE');
    expect(att.statusPatch).toBe('PRESENT');
    expect(att.adjustments[0]).toMatchObject({ approvedBy: 'hr-1' });
    expect(att.adjustments[0].reason).toContain('APPROVE');
  });

  it('approves a late punch to LATE, keeping the recorded lateness', async () => {
    const att = pending(30);
    const { svc } = make({ att });
    const row = await svc.decide(hr, 'a1', 'APPROVE', 'sinyal mati di depot');
    expect(row.status).toBe('LATE');
    expect(att.adjustments[0].reason).toBe('sinyal mati di depot');
  });

  it('rejects to ABSENT instead of deleting the row', async () => {
    const att = pending(0);
    const { svc } = make({ att });
    await svc.decide(hr, 'a1', 'REJECT');
    expect(att.statusPatch).toBe('ABSENT');
  });

  it('refuses to decide a row twice', async () => {
    const att = pending(0);
    att.row = { ...(att.row as Attendance), status: 'PRESENT' } as Attendance;
    const { svc } = make({ att });
    await expect(svc.decide(hr, 'a1', 'APPROVE')).rejects.toThrow(BadRequestException);
  });

  it('404s on an unknown row', async () => {
    const { svc } = make();
    await expect(svc.decide(hr, 'a1', 'APPROVE')).rejects.toThrow(NotFoundException);
  });

  it('refuses a depot-locked decider from another depot', async () => {
    const att = pending(0);
    const { svc } = make({ att });
    const otherDepot: AuthenticatedUser = {
      sub: 'mgr',
      role: 'MANAGER' as never,
      phone: '08',
      depotId: 'd2',
    };
    await expect(svc.decide(otherDepot, 'a1', 'APPROVE')).rejects.toThrow(ForbiddenException);
  });
});
