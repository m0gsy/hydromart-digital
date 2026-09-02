import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuthenticatedUser, ImportSummary, assertDepotAccess, depotScopeIds, runImport } from '@hydromart/platform';

import {
  Employee,
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from '../../../prisma/generated/client';
import { parseWeeklyOffDays } from '../../domain/calendar';
import {
  BLOCKING_STATUSES,
  LeaveAction,
  deductsQuota,
  leaveWorkingDays,
  nextStatus,
  rangesOverlap,
} from '../../domain/leave';
import { HrConfigService } from '../../config/hr-config.service';
import { ATTENDANCE_REPOSITORY, AttendanceRepository } from '../ports/attendance.repository';
import { HOLIDAY_REPOSITORY, HolidayRepository } from '../ports/holiday.repository';
import { LEAVE_REPOSITORY, LeaveRepository } from '../ports/leave.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../ports/notification.port';
import { SUPERVISION_PORT, SupervisionPort } from '../ports/supervision.port';
import { EmployeeService } from './employee.service';

export interface SubmitLeaveInput {
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  attachmentUrl?: string;
}

// tz-ok: leave startDate/endDate are @db.Date — whole local days, stored UTC-midnight.
const ISO_DAY = (d: Date | string): string =>
  (typeof d === 'string' ? new Date(d) : d).toISOString().slice(0, 10);

/**
 * Leave applications: employee submits, manager decides, HR decides. An approval is what
 * finally writes LEAVE attendance rows — which is how leave reaches payroll, since the
 * payroll engine already reads leaveDays off the attendance summary. Nothing in payroll
 * changes because of this module.
 */
@Injectable()
export class LeaveService {
  constructor(
    @Inject(LEAVE_REPOSITORY) private readonly repo: LeaveRepository,
    @Inject(ATTENDANCE_REPOSITORY) private readonly attendance: AttendanceRepository,
    private readonly employees: EmployeeService,
    private readonly config: HrConfigService,
    @Optional() @Inject(HOLIDAY_REPOSITORY) private readonly holidays?: HolidayRepository,
    @Optional() @Inject(NOTIFICATION_PORT) private readonly notifications?: NotificationPort,
    @Optional() @Inject(SUPERVISION_PORT) private readonly supervision?: SupervisionPort,
  ) {}

  // ── employee side ───────────────────────────────────────────────────

  async submit(user: AuthenticatedUser, input: SubmitLeaveInput): Promise<LeaveRequest> {
    const employee = await this.employees.getSelf(user);
    const start = ISO_DAY(input.startDate);
    const end = ISO_DAY(input.endDate);
    if (end < start) throw new BadRequestException('Tanggal selesai sebelum tanggal mulai');

    const days = await this.workingDaysFor(employee.depotId, start, end);
    if (days.length === 0) {
      throw new BadRequestException('Rentang tanggal tidak memuat hari kerja');
    }

    const blocking = await this.repo.listBlocking(employee.id, [...BLOCKING_STATUSES]);
    if (blocking.some((r) => rangesOverlap(start, end, ISO_DAY(r.startDate), ISO_DAY(r.endDate)))) {
      throw new ConflictException('Sudah ada pengajuan cuti pada rentang tanggal tersebut');
    }

    if (deductsQuota(input.type)) {
      const balance = await this.balanceFor(employee, new Date(`${start}T00:00:00.000Z`));
      if (balance.usedDays + days.length > balance.quotaDays) {
        throw new ConflictException(
          `Sisa kuota cuti ${balance.quotaDays - balance.usedDays} hari, pengajuan ${days.length} hari`,
        );
      }
    }

    const request = await this.repo.create({
      employeeId: employee.id,
      depotId: employee.depotId,
      type: input.type,
      startDate: new Date(`${start}T00:00:00.000Z`),
      endDate: new Date(`${end}T00:00:00.000Z`),
      workingDays: days.length,
      reason: input.reason,
      attachmentUrl: input.attachmentUrl ?? null,
    });

    await this.notifySupervisor(employee, request);
    return request;
  }

  async listSelf(user: AuthenticatedUser, page = 1, pageSize = 20) {
    const employee = await this.employees.getSelf(user);
    return this.repo.list({
      employeeId: employee.id,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async myBalance(user: AuthenticatedUser, year?: number): Promise<LeaveBalance> {
    const employee = await this.employees.getSelf(user);
    const when = year ? new Date(Date.UTC(year, 0, 1)) : new Date();
    return this.balanceFor(employee, when);
  }

  /**
   * Opening leave balances (CSV wizard), keyed by staff code. Without this, migrating
   * mid-year silently gives everyone a fresh full quota and the days they already took this
   * year vanish — so this is the one path that writes `usedDays` outright.
   *
   * A year that already has a row is overwritten, and says so: the file is the correction.
   */
  async importBalances(
    user: AuthenticatedUser,
    rows: { employeeCode: string; year: number; quotaDays: number; usedDays?: number }[],
  ): Promise<ImportSummary> {
    return runImport(rows, async (row) => {
      const employee = await this.employees.getByCode(user, row.employeeCode);
      const usedDays = row.usedDays ?? 0;
      if (usedDays > row.quotaDays) {
        throw new BadRequestException('usedDays tidak boleh melebihi quotaDays');
      }
      const { balance, existed } = await this.repo.setBalance(
        employee.id,
        row.year,
        row.quotaDays,
        usedDays,
      );
      return { status: existed ? 'updated' : 'created', id: balance.id };
    });
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<LeaveRequest> {
    const employee = await this.employees.getSelf(user);
    const request = await this.get(id);
    // Only your own application, and only while nobody has finished deciding it.
    if (request.employeeId !== employee.id) {
      throw new ForbiddenException('Bukan pengajuan cuti Anda');
    }
    return this.applyDecision(request, 'CANCEL', { actor: user.sub });
  }

  // ── approver side ───────────────────────────────────────────────────

  async listForApproval(
    user: AuthenticatedUser,
    query: { depotId?: string; status?: LeaveStatus; page?: number; pageSize?: number } = {},
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return this.repo.list({
      depotIds: depotScopeIds(user, query.depotId),
      status: query.status,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async decideManager(
    user: AuthenticatedUser,
    id: string,
    approve: boolean,
    note?: string,
  ): Promise<LeaveRequest> {
    const request = await this.get(id);
    assertDepotAccess(user, request.depotId);
    await this.assertMayDecide(user, request);
    return this.applyDecision(request, approve ? 'MANAGER_APPROVE' : 'MANAGER_REJECT', {
      actor: user.sub,
      note,
    });
  }

  async decideHr(
    user: AuthenticatedUser,
    id: string,
    approve: boolean,
    note?: string,
  ): Promise<LeaveRequest> {
    const request = await this.get(id);
    assertDepotAccess(user, request.depotId);
    await this.assertMayDecide(user, request);
    return this.applyDecision(request, approve ? 'HR_APPROVE' : 'HR_REJECT', {
      actor: user.sub,
      note,
    });
  }

  /**
   * Two stages, two people — CA-1-40.
   *
   * Both decision paths checked one thing: does this account reach the request's depot.
   * `leaveApprove` (stage 1) is MANAGER + HR and `hrAdmin` (stage 2) includes HR, so an HR
   * staffer with an employee record of their own held BOTH stages over their OWN
   * application — the two-stage flow collapsed into one click by the applicant.
   *
   * Two rules, in the one place both stages pass through:
   *
   * 1. The applicant never decides their own request, at either stage. A rejection is a
   *    decision too, so this is not "cannot self-approve": `cancel()` is the path an
   *    applicant has over their own row, and it stays untouched.
   * 2. Stage 2 is not signed by whoever signed stage 1. Two signatures from one account are
   *    one signature written twice, which is exactly what "dua tahap sekaligus" describes.
   *
   * `findByAuthSubjectId` rather than `getSelf`: an approver with no employee record of
   * their own is normal (head office, the superuser) and must not 404 here.
   */
  private async assertMayDecide(user: AuthenticatedUser, request: LeaveRequest): Promise<void> {
    if (request.managerDecidedBy && request.managerDecidedBy === user.sub) {
      throw new ForbiddenException(
        'Tahap kedua harus diputuskan orang lain, bukan pemutus tahap pertama',
      );
    }
    const self = await this.employees.findByAuthSubjectId(user.sub);
    if (self && self.id === request.employeeId) {
      throw new ForbiddenException('Tidak bisa memutuskan pengajuan cuti Anda sendiri');
    }
  }

  // ── internals ───────────────────────────────────────────────────────

  private async get(id: string): Promise<LeaveRequest> {
    const request = await this.repo.findById(id);
    if (!request) throw new NotFoundException('Pengajuan cuti tidak ditemukan');
    return request;
  }

  /** One place where a status actually moves, so every transition is checked the same way. */
  private async applyDecision(
    request: LeaveRequest,
    action: LeaveAction,
    ctx: { actor: string; note?: string },
  ): Promise<LeaveRequest> {
    const status = nextStatus(request.status, action);
    if (!status) {
      throw new ConflictException(
        `Pengajuan berstatus ${request.status} tidak bisa ${action.toLowerCase()}`,
      );
    }
    if (status === 'REJECTED' && !ctx.note?.trim()) {
      // The employee reads this. A rejection with no reason is a decision they cannot act on.
      throw new BadRequestException('Alasan penolakan wajib diisi');
    }

    const now = new Date();
    const stage = action.startsWith('MANAGER')
      ? { managerDecidedBy: ctx.actor, managerDecidedAt: now }
      : action.startsWith('HR')
        ? { hrDecidedBy: ctx.actor, hrDecidedAt: now }
        : {};
    const updated = await this.repo.decide(request.id, {
      status,
      ...stage,
      ...(ctx.note !== undefined ? { decisionNote: ctx.note ?? null } : {}),
    });

    if (status === 'APPROVED') await this.settleApproval(updated);
    await this.notifyEmployee(updated);
    return updated;
  }

  /**
   * An approval is only real once the days exist in attendance: payroll counts leaveDays
   * from there, and the depot roster reads the same rows. Quota moves here too, never on
   * submit — a pending request must not cost anyone a day that was later refused.
   */
  private async settleApproval(request: LeaveRequest): Promise<void> {
    const days = await this.workingDaysFor(
      request.depotId,
      ISO_DAY(request.startDate),
      ISO_DAY(request.endDate),
    );
    for (const day of days) {
      await this.attendance.upsertManual({
        employeeId: request.employeeId,
        depotId: request.depotId,
        workDate: new Date(`${day}T00:00:00.000Z`),
        status: 'LEAVE',
      });
    }
    if (deductsQuota(request.type)) {
      const year = request.startDate.getUTCFullYear();
      await this.repo.addUsedDays(request.employeeId, year, days.length);
    }
  }

  private async workingDaysFor(
    depotId: string | null,
    start: string,
    end: string,
  ): Promise<string[]> {
    const holidays = this.holidays
      ? await this.holidays.listDates(
          depotId,
          new Date(`${start}T00:00:00.000Z`),
          new Date(`${end}T00:00:00.000Z`),
        )
      : [];
    return leaveWorkingDays(
      start,
      end,
      new Set(holidays),
      parseWeeklyOffDays(this.config.weeklyOffDays(depotId)),
    );
  }

  private async balanceFor(employee: Employee, when: Date): Promise<LeaveBalance> {
    return this.repo.ensureBalance(
      employee.id,
      when.getUTCFullYear(),
      this.config.annualLeaveQuotaDays(employee.depotId),
    );
  }

  /**
   * Fail-open by construction: the notification port itself never throws (see A2), and the
   * supervision lookup swallows its own failures.
   *
   * The reporting line comes from depot-service's supervision table, not from
   * `Employee.supervisorId`. That column stopped being written when `/hq/hierarchy` became
   * the single place a superior is recorded; reading it here would notify whoever happened
   * to be in an older copy. Approval rights are unaffected — leave is approved by role
   * (MANAGER/HR/SUPER_ADMIN) plus the depot scope, never by this link.
   */
  private async notifySupervisor(employee: Employee, request: LeaveRequest): Promise<void> {
    if (!this.notifications || !this.supervision || !employee.authSubjectId) return;
    const superiorAccountId = await this.supervision.superiorOf(employee.authSubjectId);
    if (!superiorAccountId) return;
    const supervisor = await this.employees.findByAuthSubjectId(superiorAccountId);
    if (!supervisor?.authSubjectId) return;
    await this.notifications.notify(
      'LEAVE_SUBMITTED',
      supervisor.phone,
      {
        name: employee.fullName,
        type: request.type,
        from: ISO_DAY(request.startDate),
        to: ISO_DAY(request.endDate),
      },
      supervisor.authSubjectId,
    );
  }

  private async notifyEmployee(request: LeaveRequest): Promise<void> {
    if (!this.notifications) return;
    if (request.status !== 'APPROVED' && request.status !== 'REJECTED') return;
    const employee = await this.employees.findByIdInternal(request.employeeId);
    if (!employee?.authSubjectId) return;
    await this.notifications.notify(
      request.status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      employee.phone,
      {
        name: employee.fullName,
        type: request.type,
        from: ISO_DAY(request.startDate),
        to: ISO_DAY(request.endDate),
        reason: request.decisionNote ?? '-',
      },
      employee.authSubjectId,
    );
  }
}
