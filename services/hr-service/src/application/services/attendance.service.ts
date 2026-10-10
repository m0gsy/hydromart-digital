import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
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
import { addDays, depotOn } from '../../domain/depot-on';
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
import { hrStorageKey } from '../storage-key';
import { FACE_VERIFIER, FaceVerifier } from '../ports/face-verifier.port';
import {
  FACE_EMBEDDING_REPOSITORY,
  FaceEmbeddingRepository,
} from '../ports/face-embedding.repository';
import { EMPLOYEE_REPOSITORY, EmployeeRepository } from '../ports/employee.repository';
import { STORAGE_PORT, StoragePort } from '../ports/storage.port';
import { SHIFT_REPOSITORY, ShiftRepository } from '../ports/shift.repository';
import {
  DEPOT_ASSIGNMENT_REPOSITORY,
  DepotAssignmentRepository,
} from '../ports/depot-assignment.repository';

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
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @Inject(ATTENDANCE_REPOSITORY) private readonly repo: AttendanceRepository,
    @Inject(FACE_VERIFIER) private readonly verifier: FaceVerifier,
    @Inject(FACE_EMBEDDING_REPOSITORY) private readonly faces: FaceEmbeddingRepository,
    @Inject(EMPLOYEE_REPOSITORY) private readonly employees: EmployeeRepository,
    private readonly config: HrConfigService,
    @Optional() @Inject(STORAGE_PORT) private readonly storage?: StoragePort,
    @Optional() @Inject(SHIFT_REPOSITORY) private readonly shifts?: ShiftRepository,
    // Last: absent (specs, or the feature off) every punch is judged at the live depot.
    @Optional()
    @Inject(DEPOT_ASSIGNMENT_REPOSITORY)
    private readonly depotLedger?: DepotAssignmentRepository,
  ) {}

  /**
   * The depot an employee worked at on a local day.
   *
   * The sweep moves the live depot within a quarter hour of midnight, so a punch in those
   * minutes - or one queued offline and synced after the loan ended - would otherwise be
   * stamped, fenced and judged at the wrong depot. Off, or with no ledger, this is exactly
   * the live depot: nothing changes until the feature is switched on.
   */
  private async workDepotOn(employee: Employee, localDay: string): Promise<string | null> {
    if (!this.config.depotAssignmentEnabled || !this.depotLedger) return employee.depotId;
    const moves = await this.depotLedger.timelineFor(employee.id);
    if (moves.length === 0) return employee.depotId;
    return depotOn({ homeDepotId: employee.homeDepotId, depotId: employee.depotId }, moves, localDay);
  }

  /**
   * Who may touch a stored attendance row. With the feature on, the depot the day was
   * WORKED at decides (the destination's manager runs a lent employee's days); off, the live
   * depot decides as it always did.
   */
  private assertRowAccess(user: AuthenticatedUser, employee: Employee, row: Attendance): void {
    const depot = this.config.depotAssignmentEnabled ? (row.depotId ?? employee.depotId) : employee.depotId;
    assertDepotAccess(user, depot);
  }

  /**
   * The newest check-in still waiting for its check-out, no more than a day old: what a
   * night shift closes after midnight, when today's date holds no row at all.
   */
  private async openRowBefore(employeeId: string, at: Date): Promise<Attendance | null> {
    const today = localDayKey(at, this.config.timeZone);
    const { rows } = await this.repo.list({
      employeeId,
      from: new Date(`${addDays(today, -1)}T00:00:00.000Z`),
      to: new Date(`${today}T00:00:00.000Z`),
      skip: 0,
      take: 5,
    });
    const open = rows
      .filter(
        (r) =>
          r.checkInAt &&
          !r.checkOutAt &&
          r.checkInAt.getTime() <= at.getTime() &&
          at.getTime() - r.checkInAt.getTime() <= 24 * 3_600_000,
      )
      .sort((a, b) => (b.checkInAt as Date).getTime() - (a.checkInAt as Date).getTime());
    return open[0] ?? null;
  }

  async checkIn(
    user: AuthenticatedUser,
    punch: FacePunch,
    now: Date = new Date(),
  ): Promise<Attendance> {
    const employee = await this.resolveSelf(user);
    const score = await this.assertFace(employee, punch);

    // The moment of the punch comes first now: the geofence is the one of the depot worked at
    // on THAT day, and that cannot be known before the day is.
    const offlineAt = this.offlineAt(punch, now, employee.depotId);
    const at = offlineAt ?? now;
    const { workDate, minutesOfDay } = this.localParts(at, this.config.timeZone);
    const workDepotId = await this.workDepotOn(employee, localDayKey(at, this.config.timeZone));
    const { holdForReview } = this.geofenceOutcome({ depotId: workDepotId }, user, punch);
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
    const startMinutes = this.parseHHMM(await this.shiftStartFor(employee, workDate, workDepotId));
    const { late, lateMinutes } = latenessFor({
      minutesOfDay,
      startMinutes,
      toleranceMinutes: this.config.lateToleranceMinutes(workDepotId),
    });
    const photoUrl =
      punch.photoUrl ?? (await storeFrame(this.storage, punch.image, 'hr/attendance'));

    // A punch that reached us within the auto-accept window is indistinguishable from a live
    // one — face and geofence were re-checked here either way, and the clock gap is trivial.
    // Only a punch that sat on the device long enough for its clock to matter goes to HR.
    const stale =
      offlineAt !== null &&
      now.getTime() - offlineAt.getTime() >
        this.config.offlineAutoAcceptMinutes(workDepotId) * 60_000;

    return this.repo.create({
      employeeId: employee.id,
      depotId: workDepotId,
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

    const offlineAt = this.offlineAt(punch, now, employee.depotId);
    const { workDate } = this.localParts(offlineAt ?? now, this.config.timeZone);
    // Today's row first (the ordinary day shift). Failing that, the open row from the
    // evening before: a night shift closes after midnight, and looking only at today's date
    // answered "Belum check-in" to everyone who worked past it.
    const todays = await this.repo.findByEmployeeAndDate(employee.id, workDate);
    const row = todays?.checkInAt ? todays : await this.openRowBefore(employee.id, offlineAt ?? now);
    if (!row?.checkInAt) {
      throw new BadRequestException('Belum check-in hari ini');
    }
    // Fenced by the depot the shift was STAMPED with at check-in, not whatever the live row
    // says now: closing a shift that began before the sweep moved someone is that shift's depot.
    const { holdForReview } = this.geofenceOutcome(
      { depotId: row.depotId ?? employee.depotId },
      user,
      punch,
    );
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
  /**
   * CA-1-24 — the corrections filed against one attendance row.
   *
   * `recordAdjustment` has written these since the correction path existed, and until now
   * nothing could read them: no repository method, no route, no screen. So the trail that
   * exists precisely to answer "why does this payslip say that" could only be reached by
   * opening the database — which is the same as not having it, for everyone who has to
   * answer that question.
   *
   * Scoped exactly like `adjust` itself: the row is loaded, its employee resolved, and the
   * caller held to that employee's depot. Reading who changed somebody's attendance and why
   * is no less sensitive than making the change.
   */
  async listAdjustments(user: AuthenticatedUser, id: string) {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Data absensi tidak ditemukan');
    const employee = await this.employees.findById(row.employeeId);
    if (!employee) throw new NotFoundException('Karyawan tidak ditemukan');
    this.assertRowAccess(user, employee, row);
    return this.repo.listAdjustments(id);
  }

  /**
   * HR-4 (owner decision 2026-09-17) — attendance selfies stop being kept forever.
   *
   * Every face check-in stored a frame, and nothing ever deleted one for an employee who
   * was still on the payroll: the only sweep that touched them was the departed-staff
   * scrub. The photo is evidence for a disputed punch, and ninety days (the window head
   * office sets; admin-service passes the cutoff) is long past the payroll cycle it could
   * be disputed in.
   *
   * The OBJECT goes first and the columns are nulled after: a bucket that refuses a delete
   * leaves the row pointing at it, so the next sweep tries again instead of orphaning a face
   * nothing can find. Bounded per run so one sweep cannot hold the table.
   */
  async purgePhotosOlderThan(cutoff: Date, limit = 500): Promise<{ purged: number }> {
    const values = await this.repo.photosBefore(cutoff, limit);
    let failed = 0;
    for (const key of new Set(values.map(hrStorageKey).filter((k): k is string => !!k))) {
      if (!this.storage) break;
      try {
        await this.storage.remove(key);
      } catch (error) {
        failed += 1;
        this.logger.error(`Retention: attendance photo ${key} left behind: ${(error as Error).message}`);
      }
    }
    if (failed > 0) {
      this.logger.warn(`Retention: ${failed} attendance photo(s) could not be deleted; rows kept for the next sweep`);
      return { purged: 0 };
    }
    const purged = await this.repo.clearPhotosBefore(cutoff, limit);
    this.logger.log(`Retention: cleared attendance photos on ${purged} row(s) before ${cutoff.toISOString()}`);
    return { purged };
  }

  /**
   * CA-1-66 — the selfie the punch was accepted on, and never shown to anybody.
   *
   * Every face check-in stores a frame and a match score. HR approving or correcting a
   * day's attendance saw neither: it decided on a punch it could not look at, while the
   * photo sat in the bucket. The score is now on the row it belongs to, and the frame comes
   * back through here.
   *
   * The bytes leave through the service for the same reason documents do (SEC-01) — behind
   * `hrView` and the employee's depot check — and the key is derived from the stored URL
   * rather than fetched from it: a row whose URL points anywhere but this deployment's own
   * bucket is a 404, never a request the server makes on a caller's behalf.
   */
  async photo(
    user: AuthenticatedUser,
    id: string,
    which: 'in' | 'out',
  ): Promise<{ body: Buffer; contentType: string }> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Data absensi tidak ditemukan');
    const employee = await this.employees.findById(row.employeeId);
    if (!employee) throw new NotFoundException('Karyawan tidak ditemukan');
    this.assertRowAccess(user, employee, row);

    const key = this.storageKeyOf(which === 'in' ? row.checkInPhotoUrl : row.checkOutPhotoUrl);
    if (!key || !this.storage) throw new NotFoundException('Foto absensi tidak tersedia');
    const object = await this.storage.getObject(key);
    return { body: object.body, contentType: object.contentType ?? 'image/jpeg' };
  }

  /**
   * The object key behind a stored attendance photo, or null when there is nothing this
   * deployment can read.
   *
   * TWO SHAPES, and accepting only one of them is the defect this now closes. The column is
   * called `checkInPhotoUrl`, but `upload-frame.ts` deliberately stores the KEY and says so:
   * "the key, never the public URL. A face frame is biometric data… Reading a frame back
   * needs an authenticated route which resolves the key — which nothing asks for today, so
   * nothing exists." That route was built later and written for the OTHER shape, so it
   * stripped a base prefix that was never there, resolved null, and answered "Foto absensi
   * tidak tersedia" for EVERY photo ever taken — next to a badge reading "cocok 100%",
   * because the score is stored on the same row and did resolve.
   *
   * Measured on production 2026-09-10: both stored values are bare keys
   * (`hr/attendance/<uuid>.jpg`), zero are URLs.
   *
   * A full URL is still accepted, because a deployment that stored `stored.url` — the shape
   * `S3StorageAdapter.put` also returns — must keep reading. Anything else is "no photo",
   * which is the honest answer rather than an outbound fetch to whatever the column says.
   *
   * `hr/documents` never had this problem: it carries a separate `fileKey` column and reads
   * from that. Attendance was never given one.
   */
  private storageKeyOf(stored: string | null): string | null {
    if (!stored) return null;
    const base = this.config.storagePublicBaseUrl;
    const key = base && stored.startsWith(`${base}/`) ? stored.slice(base.length + 1) : stored;
    // Absolute anything else is another deployment's bucket, and traversal is never a key.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(key)) return null;
    return key.startsWith('hr/') && !key.includes('..') ? key : null;
  }

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
    this.assertRowAccess(user, employee, row);

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

  /**
   * HR manual attendance entry for a day with no check-in (e.g. LEAVE/HOLIDAY/ABSENT).
   *
   * CA-1-14: this used to upsert. A day that was actually punched carries a check-in time,
   * a face photo and GPS coordinates; the upsert wrote only `status`, so those stayed in
   * the row saying one thing while the status said another — and `summaryMany` counts
   * PRESENT/LATE as worked days, so retyping a punched day moved payroll. `lateMinutes`
   * survived too, keeping the tiered late fine on a day now called PRESENT.
   *
   * Manual entry is therefore only for a day with no record. Changing a day that has one
   * goes through `adjust`, which files the old value, the new value, the reason and who
   * approved it.
   */
  async createManual(
    user: AuthenticatedUser,
    input: { employeeId: string; workDate: string; status: AttendanceStatus; reason: string },
  ): Promise<Attendance> {
    const employee = await this.employees.findById(input.employeeId);
    if (!employee) throw new NotFoundException('Karyawan tidak ditemukan');
    // The day is stamped, and gated, by the depot it was worked at - not where the person is now.
    const workDepotId = await this.workDepotOn(employee, input.workDate.slice(0, 10));
    assertDepotAccess(user, workDepotId);

    const workDate = new Date(`${input.workDate.slice(0, 10)}T00:00:00.000Z`);
    const existing = await this.repo.findByEmployeeAndDate(input.employeeId, workDate);
    if (existing) {
      throw new ConflictException(
        'Hari itu sudah punya catatan kehadiran — ubah lewat koreksi pada baris tersebut, bukan absen manual',
      );
    }
    const updated = await this.repo.upsertManual({
      employeeId: input.employeeId,
      depotId: workDepotId,
      workDate,
      status: input.status,
    });
    await this.repo.recordAdjustment({
      attendanceId: updated.id,
      reason: input.reason,
      before: null,
      after: snapshot(updated),
      approvedBy: user.sub,
    });
    return updated;
  }

  /**
   * The depot this person works at now, when their TOKEN still names another one.
   *
   * The sweep moves the login's depot but a token already issued keeps its claim until it is
   * refreshed (fifteen minutes at most). The self-service routes hand this back as a header
   * so the app can refresh and re-scope straight away instead of failing with 403s until it
   * happens to. Null whenever there is nothing to say.
   */
  async depotDrift(user: AuthenticatedUser): Promise<string | null> {
    const employee = await this.employees.findByAuthSubjectId(user.sub);
    if (!employee?.depotId || !user.depotId) return null;
    return employee.depotId !== user.depotId ? employee.depotId : null;
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
  private async shiftStartFor(
    employee: Employee,
    workDate: Date,
    workDepotId: string | null,
  ): Promise<string> {
    // While lent, the roster of the depot WORKED at decides: a shift that belongs to the home
    // depot must not set the start time at the destination. Not lent, nothing is filtered.
    const home = employee.homeDepotId ?? employee.depotId;
    const lent = home !== null && workDepotId !== home;
    const startOf = async (shiftId: string): Promise<string | null> => {
      const shift = await this.shifts?.findById(shiftId);
      if (!shift || (lent && shift.depotId && shift.depotId !== workDepotId)) return null;
      return shift.startTime;
    };
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
      if (shiftId) assignedShiftStart = await startOf(shiftId);
    }

    const employeeShiftStart =
      !assignedShiftStart && this.shifts && employee.shiftId
        ? await startOf(employee.shiftId)
        : null;
    const depotShiftStart =
      !assignedShiftStart && !employeeShiftStart && this.shifts
        ? ((await this.shifts.findActiveForDepot(workDepotId))?.startTime ?? null)
        : null;

    return resolveShiftStart({
      assignedShiftStart,
      employeeShiftStart,
      depotShiftStart,
      configStartTime: this.config.workStartTime(workDepotId),
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
