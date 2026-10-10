import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  assertDepotAccess,
  depotScopeIds,
  localDayKey,
} from '@hydromart/platform';

import { Employee, EmployeeDepotAssignment } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { BackdateFacts, OpenAssignment, planProblems } from '../../domain/depot-assignment';
import { addDays, isLocalDay } from '../../domain/depot-on';
import {
  DEPOT_ASSIGNMENT_REPOSITORY,
  DepotAssignmentRepository,
} from '../ports/depot-assignment.repository';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { DEPOT_DIRECTORY_PORT, DepotDirectoryPort } from '../ports/depot-directory.port';
import { PAYROLL_REPOSITORY, PayrollRepository } from '../ports/payroll.repository';
import { DepotAssignmentApplier } from './depot-assignment-applier.service';
import { EmployeeService } from './employee.service';

export interface PlanAssignmentInput {
  employeeId: string;
  kind: 'LOAN' | 'PERMANENT';
  depotId: string;
  startDate: string;
  endDate?: string | null;
  note?: string | null;
}

// A @db.Date comes back as UTC midnight, so its first ten characters ARE the local day.
// tz-ok: @db.Date - the UTC slice IS the local day
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** The month after `YYYY-MM`. */
function nextMonth(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Planning and cancelling dated cross-depot assignments. It only RECORDS intent: nothing here
 * moves anyone. The sweep that applies a due assignment (and flips the login) is a separate
 * step, which is why every route is dark until DEPOT_ASSIGNMENT_ENABLED is set.
 */
@Injectable()
export class DepotAssignmentService {
  constructor(
    @Inject(DEPOT_ASSIGNMENT_REPOSITORY) private readonly repo: DepotAssignmentRepository,
    private readonly employees: EmployeeService,
    private readonly config: HrConfigService,
    private readonly applier: DepotAssignmentApplier,
    // Optional so a stack without depot-service wired (specs, a bare dev box) still plans.
    @Optional() @Inject(DEPOT_DIRECTORY_PORT) private readonly directory?: DepotDirectoryPort,
    // Needed only to start a plan in the past; absent, the past stays closed.
    @Optional() @Inject(PAYROLL_REPOSITORY) private readonly payrolls?: PayrollRepository,
    @Optional() @Inject(ATTENDANCE_REPOSITORY) private readonly attendance?: AttendanceRepository,
  ) {}

  private assertEnabled(): void {
    // 404, not 403/503: to a caller the feature does not exist yet, and a 5xx here would
    // page somebody for a switch that is off on purpose.
    if (!this.config.depotAssignmentEnabled) {
      throw new NotFoundException('Penugasan lintas depot belum diaktifkan');
    }
  }

  async plan(
    user: AuthenticatedUser,
    input: PlanAssignmentInput,
  ): Promise<EmployeeDepotAssignment> {
    this.assertEnabled();
    for (const key of [input.startDate, input.endDate]) {
      if (key != null && !isLocalDay(key)) {
        throw new BadRequestException(`Tanggal tidak valid: "${key}" (format YYYY-MM-DD)`);
      }
    }
    const employee = await this.employees.getById(user, input.employeeId); // 404 + depot check
    assertDepotAccess(user, input.depotId);
    return this.create(user, employee, input, 'PLANNED');
  }

  /**
   * A depot manager asks to BORROW somebody (named by employee code) for a depot of their own.
   * Only loans: a permanent move stays HR's. It is validated exactly
   * like a plan (so HR is never handed an impossible request) but written as REQUESTED: it
   * claims no days and the sweep cannot see it until HR approves. The employee belongs to
   * ANOTHER depot, so this reads them without the depot check a plan does - and returns only
   * the request, never their record.
   */
  async request(
    user: AuthenticatedUser,
    req: Omit<PlanAssignmentInput, 'employeeId' | 'kind'> & { employeeCode: string },
  ): Promise<EmployeeDepotAssignment> {
    const input = { ...req, kind: 'LOAN' as const };
    this.assertEnabled();
    for (const key of [input.startDate, input.endDate]) {
      if (key != null && !isLocalDay(key)) {
        throw new BadRequestException(`Tanggal tidak valid: "${key}" (format YYYY-MM-DD)`);
      }
    }
    assertDepotAccess(user, input.depotId); // the destination must be the requester's own
    const employee = await this.employees.findByCodeInternal(req.employeeCode.trim());
    if (!employee) throw new NotFoundException('Karyawan tidak ditemukan');
    return this.create(user, employee, { ...input, employeeId: employee.id }, 'REQUESTED');
  }

  /** HR turns a request into a plan - re-checked now, because the world moved since it was asked. */
  async approveRequest(user: AuthenticatedUser, id: string): Promise<EmployeeDepotAssignment> {
    this.assertEnabled();
    const found = await this.repo.findById(id);
    if (!found || found.status !== 'REQUESTED') {
      throw new NotFoundException('Permintaan tidak ditemukan atau sudah diputuskan');
    }
    const employee = await this.employees.getById(user, found.employeeId);
    const input: PlanAssignmentInput = {
      employeeId: found.employeeId,
      kind: found.kind,
      depotId: found.depotId,
      startDate: dayOf(found.startDate),
      endDate: found.endDate ? dayOf(found.endDate) : null,
    };
    const prepared = await this.prepare(user, employee, input);
    const decided = await this.decide(id, 'PLANNED', prepared.check, null);
    if (!decided) throw new ConflictException('Permintaan sudah diputuskan; muat ulang.');
    return decided;
  }

  async rejectRequest(
    user: AuthenticatedUser,
    id: string,
    reason: string,
  ): Promise<EmployeeDepotAssignment> {
    this.assertEnabled();
    const why = reason.trim();
    if (!why) throw new BadRequestException('Alasan penolakan wajib diisi.');
    const found = await this.repo.findById(id);
    if (!found || found.status !== 'REQUESTED') {
      throw new NotFoundException('Permintaan tidak ditemukan atau sudah diputuskan');
    }
    await this.employees.getById(user, found.employeeId);
    const decided = await this.decide(id, 'CANCELLED', null, why);
    if (!decided) throw new ConflictException('Permintaan sudah diputuskan; muat ulang.');
    return decided;
  }

  private async decide(
    id: string,
    to: 'PLANNED' | 'CANCELLED',
    check: ((open: EmployeeDepotAssignment[]) => void) | null,
    failReason: string | null,
  ): Promise<EmployeeDepotAssignment | null> {
    if (!this.repo.decideRequested) throw new ConflictException('Permintaan belum didukung.');
    return this.repo.decideRequested(id, to, check, { failReason });
  }

  /** The facts and the refusal rules shared by planning, requesting and approving. */
  private async prepare(
    user: AuthenticatedUser,
    employee: Employee,
    input: PlanAssignmentInput,
  ): Promise<{
    check: (open: EmployeeDepotAssignment[]) => void;
  }> {
    // Asked BEFORE the lock: a network call has no business inside a row-locked transaction.
    // An unreachable depot-service is a 503 (try again), never a silent yes.
    const destinationOpen = this.directory ? await this.directory.isActive(input.depotId) : true;
    const today = localDayKey(new Date(), this.config.timeZone);
    const backdate =
      input.startDate < today
        ? await this.backdateFacts(user, employee.id, input, today)
        : undefined;
    const toPlan = {
      kind: input.kind,
      depotId: input.depotId,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
    };
    const subject = {
      role: employee.role,
      hasAccount: !!employee.authSubjectId,
      status: employee.status,
      homeDepotId: employee.homeDepotId ?? employee.depotId,
      joinDate: dayOf(employee.joinDate),
      exitDate: employee.exitDate ? dayOf(employee.exitDate) : null,
    };
    const check = (open: EmployeeDepotAssignment[]): void => {
      const asOpen: OpenAssignment[] = open.map((o) => ({
        id: o.id,
        kind: o.kind,
        startDate: dayOf(o.startDate),
        endDate: o.endDate ? dayOf(o.endDate) : null,
      }));
      const problems = planProblems(toPlan, subject, asOpen, today, backdate);
      if (!destinationOpen) problems.push('Depot tujuan tidak aktif (sedang ditutup).');
      if (problems.length > 0) throw new BadRequestException(problems);
    };
    return { check };
  }

  private async create(
    user: AuthenticatedUser,
    employee: Employee,
    input: PlanAssignmentInput,
    status: 'PLANNED' | 'REQUESTED',
  ): Promise<EmployeeDepotAssignment> {
    const { check } = await this.prepare(user, employee, input);
    return this.repo.createChecked(
      {
        employeeId: employee.id,
        kind: input.kind,
        depotId: input.depotId,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        createdByRole: user.role,
        createdBy: UUID.test(user.sub) ? user.sub : null,
        note: input.note ?? null,
        ...(status === 'REQUESTED' ? { status } : {}),
      },
      check,
    );
  }

  /**
   * What the past looks like for a plan that wants to start in it. A missing reader is read as
   * "locked": without payroll and attendance to ask, nobody may rewrite history.
   */
  private async backdateFacts(
    user: AuthenticatedUser,
    employeeId: string,
    input: PlanAssignmentInput,
    today: string,
  ): Promise<BackdateFacts> {
    const mayBackdate = ['HR', 'SUPER_ADMIN'].includes(String(user.role));
    if (!mayBackdate || !this.payrolls || !this.attendance) {
      return {
        actorMayBackdate: false,
        lockedMonths: [],
        stampConflicts: 0,
      };
    }
    const lockedMonths: string[] = [];
    for (let m = input.startDate.slice(0, 7); m <= today.slice(0, 7); m = nextMonth(m)) {
      const slip = await this.payrolls.findByEmployeeAndPeriod(employeeId, m);
      if (slip && slip.status !== 'DRAFT') lockedMonths.push(m);
    }
    const last = input.endDate && input.endDate < today ? input.endDate : addDays(today, -1);
    const { rows } = await this.attendance.list({
      employeeId,
      from: new Date(`${input.startDate}T00:00:00.000Z`),
      to: new Date(`${last}T00:00:00.000Z`),
      skip: 0,
      take: 500,
    });
    const stampConflicts = rows.filter((r) => r.depotId && r.depotId !== input.depotId).length;
    return { actorMayBackdate: true, lockedMonths, stampConflicts };
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<EmployeeDepotAssignment> {
    this.assertEnabled();
    const found = await this.repo.findById(id);
    if (!found) throw new NotFoundException('Penugasan tidak ditemukan');
    await this.employees.getById(user, found.employeeId); // depot check on the employee
    if (found.status === 'ACTIVE' && found.kind === 'LOAN') {
      // Cutting a running loan short: the person goes home today, past days stay the
      // destination's. The same flip as the sweep's return, with today as its date.
      await this.applier.cutActive(found);
      return (await this.repo.findById(id)) as EmployeeDepotAssignment;
    }
    if (found.status !== 'PLANNED') {
      throw new ConflictException(`Penugasan sudah ${found.status} dan tidak bisa dibatalkan.`);
    }
    const cancelled = await this.repo.cancelPlanned(id);
    // Lost the race: the sweep (or another tab) moved it between the read and the write.
    if (!cancelled)
      throw new ConflictException('Status penugasan berubah; muat ulang lalu coba lagi.');
    return cancelled;
  }

  /** "Terapkan sekarang": what the sweep would do for this one row, without waiting for the tick. */
  async applyNow(user: AuthenticatedUser, id: string): Promise<EmployeeDepotAssignment> {
    this.assertEnabled();
    const found = await this.repo.findById(id);
    if (!found) throw new NotFoundException('Penugasan tidak ditemukan');
    await this.employees.getById(user, found.employeeId);
    const today = localDayKey(new Date(), this.config.timeZone);
    const due =
      (found.status === 'PLANNED' && dayOf(found.startDate) <= today) ||
      (found.status === 'ACTIVE' && !!found.endDate && dayOf(found.endDate) < today);
    if (!due) {
      throw new ConflictException('Penugasan ini belum jatuh tempo, atau sudah selesai.');
    }
    await this.applier.applyOne(found);
    return (await this.repo.findById(id)) as EmployeeDepotAssignment;
  }

  /** A manager reading back what they asked for (and what became of it). */
  async myRequests(
    user: AuthenticatedUser,
    query: { page?: number; pageSize?: number },
  ): Promise<{ rows: EmployeeDepotAssignment[]; total: number }> {
    this.assertEnabled();
    const page = Math.max(1, query.page ?? 1);
    const take = Math.min(100, Math.max(1, query.pageSize ?? 20));
    return this.repo.list({ createdBy: user.sub, skip: (page - 1) * take, take });
  }

  async list(
    user: AuthenticatedUser,
    query: { employeeId?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<{ rows: EmployeeDepotAssignment[]; total: number }> {
    this.assertEnabled();
    if (query.employeeId) await this.employees.getById(user, query.employeeId);
    const page = Math.max(1, query.page ?? 1);
    const take = Math.min(100, Math.max(1, query.pageSize ?? 20));
    return this.repo.list({
      employeeId: query.employeeId,
      status: query.status as never,
      depotIds: depotScopeIds(user),
      skip: (page - 1) * take,
      take,
    });
  }
}
