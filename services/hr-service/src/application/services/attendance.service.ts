import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedUser, depotScopeFilter } from '@hydromart/platform';

import { Attendance, Employee } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { uploadFrame } from '../../infrastructure/storage/upload-frame';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { FACE_VERIFIER, FaceVerifier } from '../ports/face-verifier.port';
import {
  FACE_EMBEDDING_REPOSITORY,
  FaceEmbeddingRepository,
} from '../ports/face-embedding.repository';
import { EMPLOYEE_REPOSITORY, EmployeeRepository } from '../ports/employee.repository';
import { STORAGE_PORT, StoragePort } from '../ports/storage.port';

export interface FacePunch {
  image: Buffer;
  photoUrl: string | null;
  live: boolean;
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
  ) {}

  async checkIn(user: AuthenticatedUser, punch: FacePunch, now: Date = new Date()): Promise<Attendance> {
    const employee = await this.resolveSelf(user);
    const score = await this.assertFace(employee.id, punch);

    const { workDate, minutesOfDay } = this.localParts(now, this.config.timeZone);
    const existing = await this.repo.findByEmployeeAndDate(employee.id, workDate);
    if (existing?.checkInAt) {
      throw new BadRequestException('Sudah check-in hari ini');
    }

    const startMinutes = this.parseHHMM(this.config.workStartTime(employee.depotId));
    const tolerance = this.config.lateToleranceMinutes(employee.depotId);
    const late = minutesOfDay > startMinutes + tolerance;
    const lateMinutes = late ? minutesOfDay - startMinutes : 0;
    const photoUrl = punch.photoUrl ?? (await uploadFrame(this.storage, punch.image, 'hr/attendance'));

    return this.repo.create({
      employeeId: employee.id,
      depotId: employee.depotId,
      workDate,
      checkInAt: now,
      checkInPhotoUrl: photoUrl,
      checkInScore: score,
      lateMinutes,
      status: late ? 'LATE' : 'PRESENT',
    });
  }

  async checkOut(user: AuthenticatedUser, punch: FacePunch, now: Date = new Date()): Promise<Attendance> {
    const employee = await this.resolveSelf(user);
    const score = await this.assertFace(employee.id, punch);

    const { workDate } = this.localParts(now, this.config.timeZone);
    const row = await this.repo.findByEmployeeAndDate(employee.id, workDate);
    if (!row?.checkInAt) {
      throw new BadRequestException('Belum check-in hari ini');
    }
    if (row.checkOutAt) {
      throw new BadRequestException('Sudah check-out hari ini');
    }

    const workingMinutes = Math.max(0, Math.round((now.getTime() - row.checkInAt.getTime()) / 60000));
    const photoUrl = punch.photoUrl ?? (await uploadFrame(this.storage, punch.image, 'hr/attendance'));
    return this.repo.patchCheckOut(row.id, {
      checkOutAt: now,
      checkOutPhotoUrl: photoUrl,
      checkOutScore: score,
      workingMinutes,
    });
  }

  /** Depot-scoped attendance log for the HR dashboard / manager (their own depot only). */
  async list(
    user: AuthenticatedUser,
    query: { depotId?: string; employeeId?: string; from?: string; to?: string; page: number; pageSize: number },
  ): Promise<{ rows: Attendance[]; total: number; page: number; pageSize: number }> {
    const depotId = depotScopeFilter(user, query.depotId);
    const { rows, total } = await this.repo.list({
      depotId,
      employeeId: query.employeeId,
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

  /** Liveness + 1:N face match against the employee's enrolled set; returns the match score. */
  private async assertFace(employeeId: string, punch: FacePunch): Promise<number> {
    const enrolled = await this.faces.listActiveByEmployee(employeeId);
    if (enrolled.length === 0) {
      throw new BadRequestException('Wajah belum di-enroll');
    }
    const result = await this.verifier.verify(
      punch.image,
      enrolled.map((e) => e.vector),
      punch.live,
    );
    if (!result.live) {
      throw new BadRequestException('Deteksi liveness gagal, coba lagi');
    }
    if (!result.matched) {
      throw new UnauthorizedException('Wajah tidak cocok');
    }
    return result.score;
  }

  /** Local calendar date (as a UTC-midnight Date for @db.Date) + minutes-since-midnight in `tz`. */
  private localParts(now: Date, tz: string): { workDate: Date; minutesOfDay: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
    const workDate = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00.000Z`);
    const minutesOfDay = Number(get('hour')) * 60 + Number(get('minute'));
    return { workDate, minutesOfDay };
  }

  private parseHHMM(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }
}
