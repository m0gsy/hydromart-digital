import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  assertDepotAccess,
  depotScopeIds,
  localDayKey,
  localMinutesOfDay,
} from '@hydromart/platform';

import { Attendance, AttendanceStatus, Employee } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { withinGeofence } from '../../domain/geofence';
import { latenessFor } from '../../domain/lateness';
import {
  assignmentInForce,
  parseRotationPattern,
  resolveShiftStart,
  shiftIdForDay,
} from '../../domain/shift-rotation';
import { storeFrame } from '../../infrastructure/storage/upload-frame';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { FACE_VERIFIER, FaceVerifier } from '../ports/face-verifier.port';
import {
  FACE_EMBEDDING_REPOSITORY,
  FaceEmbeddingRepository,
} from '../ports/face-embedding.repository';
import { EMPLOYEE_REPOSITORY, EmployeeRepository } from '../ports/employee.repository';
import { STORAGE_PORT, StoragePort } from '../ports/storage.port';
import { SHIFT_REPOSITORY, ShiftRepository } from '../ports/shift.repository';

export interface FacePunch {
  image: Buffer;
  photoUrl: string | null;
  lat: number;
  lng: number;
  /** Device time for a punch queued offline; null for a live punch. */
  capturedAt?: Date | null;
}

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(ATTENDANCE_REPOSITORY) private readonly repo: AttendanceRepository,
    @Inject(FACE_VERIFIER) private readonly verifier: FaceVerifier,
    @Inject(FACE_EMBEDDING_REPOSITORY) private readonly faces: FaceEmbeddingRepository,
    @Inject(EMPLOYEE_REPOSITORY) private readonly employees: EmployeeRepository,
    private readonly config: HrConfigService,
    @Optional() @Inject(STORAGE_PORT) private readonly storage?: StoragePort,
    @Optional() @Inject(SHIFT_REPOSITORY) private readonly shifts?: ShiftRepository,
  ) {}

  async checkIn(
    user: AuthenticatedUser,
    punch: FacePunch,
    now: Date = new Date(),
  ): Promise<Attendance> {
    const employee = await this.resolveSelf(user);
    const score = await this.assertFace(employee, punch);
    const { holdForReview } = this.geofenceOutcome(employee, user, punch);

    const offlineAt = this.offlineAt(punch, now, employee.depotId);
    const at = offlineAt ?? now;
    const { workDate, minutesOfDay } = this.localParts(at, this.config.timeZone);
    const existing = await this.repo.findByEmployeeAndDate(employee.id, workDate);
    if (existing?.checkInAt) {
      /*
       * The replay of a punch that already landed.
       *
       * The face punch rides the offline capture queue (apps/web/src/lib/offline-queue.ts),
       * and the queue retries a job it never got an answer for — including the answer lost
       * AFTER this row was written. That retry used to get "Sudah check-in hari ini", a 400,
       * which `isRetryable` in that file correctly does not retry: the job was marked failed
       * and the employee was told their attendance did not record while it had.
       *
       * Identified precisely rather than guessed. `offlineAt` is `min(capturedAt, now)`, so
       * a queued punch replaying the same `capturedAt` computes the same instant to the
       * millisecond — if the stored check-in is that instant, this is that punch arriving
       * twice. A punch with no `capturedAt` is a live one, and a second live punch is a
       * genuine second attempt that must still be refused.
       */
      if (punch.capturedAt && existing.checkInAt.getTime() === at.getTime()) return existing;
      throw new BadRequestException('Sudah check-in hari ini');
    }

    // Late is measured against THIS employee's shift for THIS day (C3), falling back to the
    // depot's shift and then config — so anyone HR has not assigned is judged exactly as
    // before this existed.
    const startMinutes = this.parseHHMM(await this.shiftStartFor(employee, workDate));
    const { late, lateMinutes } = latenessFor({
      minutesOfDay,
      startMinutes,
      toleranceMinutes: this.config.lateToleranceMinutes(employee.depotId),
    });
    const photoUrl =
      punch.photoUrl ?? (await storeFrame(this.storage, punch.image, 'hr/attendance'));

    // A punch that reached us within the auto-accept window is indistinguishable from a live
    // one — face and geofence were re-checked here either way, and the clock gap is trivial.
    // Only a punch that sat on the device long enough for its clock to matter goes to HR.
    const stale =
      offlineAt !== null &&
      now.getTime() - offlineAt.getTime() >
        this.config.offlineAutoAcceptMinutes(employee.depotId) * 60_000;

    return this.repo.create({
      employeeId: employee.id,
      depotId: employee.depotId,
      workDate,
      checkInAt: at,
      checkInPhotoUrl: photoUrl,
      checkInScore: score,
      checkInLat: punch.lat,
      checkInLng: punch.lng,
      lateMinutes,
      status: stale || holdForReview ? 'PENDING' : late ? 'LATE' : 'PRESENT',
    });
  }

  async checkOut(
    user: AuthenticatedUser,
    punch: FacePunch,
    now: Date = new Date(),
  ): Promise<Attendance> {
    const employee = await this.resolveSelf(user);
    const score = await this.assertFace(employee, punch);
    const { holdForReview } = this.geofenceOutcome(employee, user, punch);

    const offlineAt = this.offlineAt(punch, now, employee.depotId);
    const { workDate } = this.localParts(offlineAt ?? now, this.config.timeZone);
    const row = await this.repo.findByEmployeeAndDate(employee.id, workDate);
    if (!row?.checkInAt) {
      throw new BadRequestException('Belum check-in hari ini');
    }
    // Floored at check-in and capped at server time by offlineAt(), so an offline check-out can
    // only ever report a shorter shift than the reconnect moment — it needs no HR approval.
    const at = offlineAt ? new Date(Math.max(offlineAt.getTime(), row.checkInAt.getTime())) : now;
    if (row.checkOutAt) {
      // Same replay rule as `checkIn` above, and for the same queue.
      if (punch.capturedAt && row.checkOutAt.getTime() === at.getTime()) return row;
      throw new BadRequestException('Sudah check-out hari ini');
    }

    const workingMinutes = Math.max(
      0,
      Math.round((at.getTime() - row.checkInAt.getTime()) / 60000),
    );
    const photoUrl =
      punch.photoUrl ?? (await storeFrame(this.storage, punch.image, 'hr/attendance'));
    const updated = await this.repo.patchCheckOut(row.id, {
      checkOutAt: at,
      checkOutPhotoUrl: photoUrl,
      checkOutScore: score,
      checkOutLat: punch.lat,
      checkOutLng: punch.lng,
      workingMinutes,
    });
    // A check-out taken away from every supervised site puts the whole day in front of HR,
    // not just the closing punch — the day is what payroll counts. Already-PENDING days stay
    // where they are rather than being re-queued.
    if (holdForReview && updated.status !== 'PENDING') {
      return this.repo.patchStatus(row.id, 'PENDING');
    }
    return updated;
  }

  /**
   * Device capture time for an offline punch, clamped so a wrong or hostile clock cannot
   * backdate further than the offline window really was. Null for a live punch.
   */
  private offlineAt(punch: FacePunch, now: Date, depotId: string | null): Date | null {
    if (!punch.capturedAt) return null;
    const maxAgeMs = this.config.offlineMaxAgeHours(depotId) * 3_600_000;
    if (punch.capturedAt.getTime() < now.getTime() - maxAgeMs) {
      throw new BadRequestException('Absen offline sudah terlalu lama. Minta entri manual ke HR.');
    }
    return new Date(Math.min(punch.capturedAt.getTime(), now.getTime()));
  }

  /** HR decides a punch left PENDING by a late offline sync. Approval keeps the recorded lateness. */
  async decide(
    user: AuthenticatedUser,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    note?: string,
  ): Promise<Attendance> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Data absensi tidak ditemukan');
    assertDepotAccess(user, row.depotId);
    if (row.status !== 'PENDING') {
      throw new BadRequestException('Absen ini sudah diputuskan');
    }
    // Rejected rows become ABSENT rather than disappearing: the unique key stays taken so the
    // same punch cannot be quietly re-queued, and the absence deduction applies as it should.
    const status: AttendanceStatus =
      decision === 'APPROVE' ? (row.lateMinutes > 0 ? 'LATE' : 'PRESENT') : 'ABSENT';
    const updated = await this.repo.patchStatus(row.id, status);
    await this.repo.recordAdjustment({
      attendanceId: row.id,
      reason: note?.trim() || `Absen offline: ${decision}`,
      before: snapshot(row),
      after: snapshot(updated),
      approvedBy: user.sub,
    });
    return updated;
  }

  /** Reject a punch taken outside the depot's attendance geofence (no-op if unconfigured). */
  private assertGeofence(depotId: string | null, punch: FacePunch): void {
    const { ok, distanceM } = withinGeofence(this.config.geofence(depotId), punch.lat, punch.lng);
    if (!ok) {
      throw new ForbiddenException(
        `Di luar area absen depot (${distanceM} m dari titik). Absen harus di lokasi.`,
      );
    }
  }

  /**
   * Where a punch is allowed to happen, which differs by rank.
   *
   * An employee tied to ONE depot is fenced to it and refused outside — unchanged.
   *
   * An employee ABOVE a depot (Asisten SPV and up carry no `depotId`) has no single place
   * to stand: they punch at whichever depot they are supervising that day. So the punch is
   * measured against every depot in their resolved scope — the set DepotScopeGuard already
   * put on the request, so this costs no lookup — and inside ANY of them is on-site.
   *
   * Outside all of them is NOT a refusal. Refusing would strand a supervisor who is
   * genuinely at a site whose geofence nobody configured; letting it through silently
   * would make the fence decorative. So it is held as PENDING for HR to decide, the same
   * path a late offline sync already takes: worth nothing to payroll until a human agrees.
   *
   * Returns `holdForReview`. Never throws for the no-home-depot case.
   */
  private geofenceOutcome(
    employee: Pick<Employee, 'depotId'>,
    user: AuthenticatedUser,
    punch: FacePunch,
  ): { holdForReview: boolean } {
    if (employee.depotId) {
      this.assertGeofence(employee.depotId, punch);
      return { holdForReview: false };
    }

    const scope = user.depotIds ?? [];
    // Nothing to measure against: no supervised depots, or none of them has a fence
    // configured. Keep the standing rule for an unconfigured fence — record the GPS,
    // don't block, don't bother HR.
    const fenced = scope.filter((id) => this.isFenced(id));
    if (fenced.length === 0) {
      this.assertGeofence(null, punch);
      return { holdForReview: false };
    }

    const onSite = fenced.some(
      (id) => withinGeofence(this.config.geofence(id), punch.lat, punch.lng).ok,
    );
    return { holdForReview: !onSite };
  }

  /** True when this depot actually has an attendance geofence configured. */
  private isFenced(depotId: string): boolean {
    const g = this.config.geofence(depotId);
    return g.lat !== null && g.lng !== null && g.radiusM > 0;
  }

  /** Depot-scoped attendance log for the HR dashboard / manager (their own depot only). */
  async list(
    user: AuthenticatedUser,
    query: {
      depotId?: string;
      employeeId?: string;
      status?: string;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: Attendance[]; total: number; page: number; pageSize: number }> {
    const depotIds = depotScopeIds(user, query.depotId);
    const { rows, total } = await this.repo.list({
      depotIds,
      employeeId: query.employeeId,
      status: query.status as AttendanceStatus | undefined,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }

  /** The caller's OWN attendance log (self-service PWA). Scoped by the linked employee. */
  async listSelf(
    user: AuthenticatedUser,
    query: { from?: string; to?: string; page: number; pageSize: number },
  ): Promise<{ rows: Attendance[]; total: number; page: number; pageSize: number }> {
    const employee = await this.resolveSelf(user);
    const { rows, total } = await this.repo.list({
      employeeId: employee.id,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }

  /** HR manual correction of an existing attendance row (status/times), kept in the audit log. */
  async adjust(
    user: AuthenticatedUser,
    id: string,
    patch: {
      status?: AttendanceStatus;
      checkInAt?: string;
      checkOutAt?: string;
      lateMinutes?: number;
      reason: string;
    },
  ): Promise<Attendance> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Data absensi tidak ditemukan');
    const employee = await this.employees.findById(row.employeeId);
    if (!employee) throw new NotFoundException('Karyawan tidak ditemukan');
    assertDepotAccess(user, employee.depotId);

    const before = snapshot(row);
    const updated = await this.repo.upsertManual({
      employeeId: row.employeeId,
      depotId: row.depotId,
      workDate: row.workDate,
      status: patch.status ?? row.status,
      lateMinutes: patch.lateMinutes,
      checkInAt: patch.checkInAt ? new Date(patch.checkInAt) : undefined,
      checkOutAt: patch.checkOutAt ? new Date(patch.checkOutAt) : undefined,
    });
    await this.repo.recordAdjustment({
      attendanceId: row.id,
      reason: patch.reason,
      before,
      after: snapshot(updated),
      approvedBy: user.sub,
    });
    return updated;
  }

  /** HR manual attendance entry for a day with no check-in (e.g. LEAVE/HOLIDAY/ABSENT). */
  async createManual(
    user: AuthenticatedUser,
    input: { employeeId: string; workDate: string; status: AttendanceStatus; reason: string },
  ): Promise<Attendance> {
    const employee = await this.employees.findById(input.employeeId);
    if (!employee) throw new NotFoundException('Karyawan tidak ditemukan');
    assertDepotAccess(user, employee.depotId);

    const workDate = new Date(`${input.workDate.slice(0, 10)}T00:00:00.000Z`);
    const existing = await this.repo.findByEmployeeAndDate(input.employeeId, workDate);
    const updated = await this.repo.upsertManual({
      employeeId: input.employeeId,
      depotId: employee.depotId,
      workDate,
      status: input.status,
    });
    await this.repo.recordAdjustment({
      attendanceId: updated.id,
      reason: input.reason,
      before: existing ? snapshot(existing) : null,
      after: snapshot(updated),
      approvedBy: user.sub,
    });
    return updated;
  }

  private async resolveSelf(user: AuthenticatedUser): Promise<Employee> {
    const employee = await this.employees.findByAuthSubjectId(user.sub);
    if (!employee) {
      throw new NotFoundException('Akun ini belum tertaut ke data karyawan');
    }
    if (employee.status !== 'ACTIVE') {
      throw new ForbiddenException('Karyawan tidak aktif');
    }
    return employee;
  }

  /**
   * Face match against the employee's enrolled set; returns the match score.
   *
   * B-7: the liveness verdict used to come from the request body — the caller asserting
   * their own anti-spoofing check had passed — so it barred nobody who was trying and only
   * ever stopped honest clients. The face match is the control; the PWA's blink challenge
   * stays a capture-quality gate on the device.
   */
  private async assertFace(employee: Employee, punch: FacePunch): Promise<number> {
    const enrolled = await this.faces.listActiveByEmployee(employee.id);
    if (enrolled.length === 0) {
      throw new BadRequestException('Wajah belum di-enroll');
    }
    const result = await this.verifier.verify(
      punch.image,
      enrolled.map((e) => e.vector),
      { userId: employee.id, userName: employee.fullName },
    );
    if (!result.matched) {
      throw new UnauthorizedException('Wajah tidak cocok');
    }
    return result.score;
  }

  /**
   * Local calendar date (as a UTC-midnight Date for @db.Date) + minutes-since-midnight.
   *
   * C4: this used to carry its own `Intl` block — a second copy of the platform's day
   * boundary living inside hr-service, next to a third one in analytics.service. Copies of
   * a rule that decides which day a punch belongs to are how two screens end up disagreeing
   * about the same morning.
   */
  private localParts(now: Date, tz: string): { workDate: Date; minutesOfDay: number } {
    return {
      workDate: new Date(`${localDayKey(now, tz)}T00:00:00.000Z`),
      minutesOfDay: localMinutesOfDay(now, tz),
    };
  }

  private parseHHMM(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  /**
   * The start time a punch is judged against, most specific first (C3):
   *
   *   employee's shift assignment for that weekday
   *     -> Employee.shiftId (set directly on the record)
   *       -> the depot's active shift
   *         -> the configured work start time
   *
   * The last two rungs are what the service did before rotations existed, so an employee
   * with neither an assignment nor a shiftId sees no change in how their day is marked.
   */
  private async shiftStartFor(employee: Employee, workDate: Date): Promise<string> {
    let assignedShiftStart: string | null = null;
    if (this.shifts) {
      const assignments = await this.shifts.listAssignmentsUpTo(employee.id, workDate);
      const inForce = assignmentInForce(assignments, workDate);
      const rotation = inForce?.rotationId
        ? await this.shifts.findRotationById(inForce.rotationId)
        : null;
      const shiftId = shiftIdForDay(
        inForce,
        rotation ? parseRotationPattern(rotation.pattern) : null,
        workDate,
      );
      if (shiftId) assignedShiftStart = (await this.shifts.findById(shiftId))?.startTime ?? null;
    }

    const employeeShiftStart =
      !assignedShiftStart && this.shifts && employee.shiftId
        ? ((await this.shifts.findById(employee.shiftId))?.startTime ?? null)
        : null;
    const depotShiftStart =
      !assignedShiftStart && !employeeShiftStart && this.shifts
        ? ((await this.shifts.findActiveForDepot(employee.depotId))?.startTime ?? null)
        : null;

    return resolveShiftStart({
      assignedShiftStart,
      employeeShiftStart,
      depotShiftStart,
      configStartTime: this.config.workStartTime(employee.depotId),
    }).startTime;
  }
}

/** Compact before/after view of an attendance row for the audit trail. */
function snapshot(row: Attendance): Record<string, unknown> {
  return {
    status: row.status,
    checkInAt: row.checkInAt?.toISOString() ?? null,
    checkOutAt: row.checkOutAt?.toISOString() ?? null,
    lateMinutes: row.lateMinutes,
  };
}
