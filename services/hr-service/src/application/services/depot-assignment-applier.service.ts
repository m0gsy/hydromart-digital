import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { localDayKey } from '@hydromart/platform';
import { HR_MANAGED_ROLES, type HrManagedRole } from '@hydromart/access';

import { Employee, EmployeeDepotAssignment, Prisma } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { addDays } from '../../domain/depot-on';
import { DEPARTMENT_REPOSITORY, DepartmentRepository } from '../ports/department.repository';
import {
  DEPOT_ASSIGNMENT_REPOSITORY,
  DepotAssignmentRepository,
} from '../ports/depot-assignment.repository';
import {
  DepotMoveWrite,
  EMPLOYEE_REPOSITORY,
  EmployeeRepository,
} from '../ports/employee.repository';
import { DEPOT_DIRECTORY_PORT, DepotDirectoryPort } from '../ports/depot-directory.port';
import { IDENTITY_PORT, IdentityPort } from '../ports/identity.port';
import { AuditService } from './audit.service';

export interface ApplyDueResult {
  /** Assignments the sweep found waiting. */
  due: number;
  applied: number;
  failed: number;
  /** The master switch is off: nothing was read, nothing was applied. */
  disabled?: boolean;
  /** Sweeps answer `ok:false` only when a whole round achieved nothing (see sweep.sh). */
  ok?: false;
}

const asDate = (key: string): Date => new Date(`${key}T00:00:00.000Z`);
// A @db.Date is read back as UTC midnight, so its first ten characters ARE the local day.
// tz-ok: @db.Date - the UTC slice IS the local day
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

type Phase = 'START' | 'END';

/** A failure retrying cannot fix: the row gives up immediately and says why. */
class GiveUp extends Error {}

/**
 * Applies due assignments: moves the employee's login and row to the depot, and back.
 *
 * Order matters and is the whole point of this class. The LOGIN moves first
 * (`identity.assignRole`, which fails hard), then ONE statement writes the employee, the
 * ledger row, the assignment's new state and the pending requests together. If the second
 * half fails after the first succeeded, the assignment is still due, the next round repeats
 * the idempotent login push and writes again - the two records can disagree for one tick,
 * never permanently.
 */
@Injectable()
export class DepotAssignmentApplier {
  /** One tick's ceiling; a bigger backlog drains over the following ticks. */
  static readonly SWEEP_BATCH = 100;
  /** After this many failed starts a PLANNED assignment gives up and says why. */
  static readonly MAX_ATTEMPTS = 5;
  private readonly logger = new Logger(DepotAssignmentApplier.name);

  constructor(
    @Inject(DEPOT_ASSIGNMENT_REPOSITORY) private readonly assignments: DepotAssignmentRepository,
    @Inject(EMPLOYEE_REPOSITORY) private readonly employees: EmployeeRepository,
    @Inject(IDENTITY_PORT) private readonly identity: IdentityPort,
    private readonly config: HrConfigService,
    private readonly audit: AuditService,
    @Optional() @Inject(DEPARTMENT_REPOSITORY) private readonly departments?: DepartmentRepository,
    @Optional() @Inject(DEPOT_DIRECTORY_PORT) private readonly directory?: DepotDirectoryPort,
  ) {}

  today(now: Date): string {
    return localDayKey(now, this.config.timeZone);
  }

  async applyDue(now: Date = new Date()): Promise<ApplyDueResult> {
    if (!this.config.depotAssignmentEnabled) {
      return { due: 0, applied: 0, failed: 0, disabled: true };
    }
    const today = this.today(now);
    const rows = await this.assignments.findDue(today, DepotAssignmentApplier.SWEEP_BATCH);
    // Catch-up keeps the ORIGINAL dates: a loan that ended while the sweep was down is
    // started and ended with its real effective days, and an end always precedes a start
    // that lands on the same day (B -> C hands over without a stop at home).
    const steps = rows
      .map((row) =>
        row.status === 'PLANNED'
          ? { row, phase: 'START' as Phase, effective: dayOf(row.startDate) }
          : { row, phase: 'END' as Phase, effective: addDays(dayOf(row.endDate as Date), 1) },
      )
      // Oldest effective day first; on a tie an END (0) goes before a START (1).
      .sort((a, b) => {
        const ka = `${a.effective}|${a.phase === 'END' ? 0 : 1}`;
        const kb = `${b.effective}|${b.phase === 'END' ? 0 : 1}`;
        return ka === kb ? 0 : ka < kb ? -1 : 1;
      });

    let applied = 0;
    let failed = 0;
    for (const step of steps) {
      try {
        await this.applyStep(step.row, step.phase, step.effective, now);
        applied += 1;
        // A loan whose whole span is already behind us ends in the same round it starts.
        if (
          step.phase === 'START' &&
          step.row.kind === 'LOAN' &&
          step.row.endDate &&
          addDays(dayOf(step.row.endDate), 1) <= today
        ) {
          const fresh = await this.assignments.findById(step.row.id);
          if (fresh?.status === 'ACTIVE') {
            await this.applyStep(fresh, 'END', addDays(dayOf(step.row.endDate), 1), now);
            applied += 1;
          }
        }
      } catch (err) {
        failed += 1;
        await this.fail(step.row, err);
      }
    }
    const result: ApplyDueResult = { due: steps.length, applied, failed };
    // `ok:false` is for a round that achieved NOTHING; one bad row among good ones is not it.
    if (steps.length > 0 && applied === 0) result.ok = false;
    return result;
  }

  /** One assignment, now - the "Terapkan sekarang" button. Throws what the sweep would swallow. */
  async applyOne(row: EmployeeDepotAssignment, now: Date = new Date()): Promise<void> {
    if (row.status === 'PLANNED') {
      await this.applyStep(row, 'START', dayOf(row.startDate), now);
    } else {
      await this.applyStep(row, 'END', addDays(dayOf(row.endDate as Date), 1), now);
    }
  }

  /**
   * End a running loan today instead of on its planned last day (the assignment was cut
   * short). Days already worked at the destination stay the destination's: the ledger row
   * lands on today, nothing before it moves.
   */
  async cutActive(row: EmployeeDepotAssignment, now: Date = new Date()): Promise<void> {
    const today = this.today(now);
    const lastDay = addDays(today, -1);
    const start = dayOf(row.startDate);
    await this.applyStep(row, 'END', today, now, {
      // The CHECK wants end >= start; a loan cut on its first day keeps that one day on paper
      // while the ledger (which payroll reads) already has the person home.
      endDate: asDate(lastDay < start ? start : lastDay),
    });
  }

  private async applyStep(
    row: EmployeeDepotAssignment,
    phase: Phase,
    effective: string,
    now: Date,
    assignmentExtra: Prisma.EmployeeDepotAssignmentUpdateInput = {},
  ): Promise<void> {
    const employee = await this.employees.findById(row.employeeId);
    if (!employee) throw new Error('Karyawan tidak ditemukan');

    const active = employee.status === 'ACTIVE';
    if (phase === 'START' && !active) {
      // Nobody is lent out after they resigned: retrying will never help.
      throw new GiveUp('Karyawan tidak aktif lagi');
    }

    const home = employee.homeDepotId ?? null;
    const target = phase === 'START' ? row.depotId : home;
    if (!target) throw new Error('Depot tujuan tidak diketahui');
    // Going TO a depot, it must still be open: it may have closed since the plan was made.
    // Closed is final (give up, say why); unreachable throws and is retried next tick. Coming
    // HOME is never blocked - the person has to be able to leave a depot that closed.
    if (phase === 'START' && this.directory && !(await this.directory.isActive(target))) {
      throw new GiveUp('Depot tujuan tidak aktif lagi');
    }
    const permanent = row.kind === 'PERMANENT';

    // The login first. KEPALA_DEPOT lent out signs in as STAFF_DEPOT at the destination - the
    // destination already has its own head and the rule is one head per depot - while the
    // employee row keeps KEPALA_DEPOT so tenure pay does not move. Coming home restores it.
    if (employee.authSubjectId && (active || phase === 'START')) {
      await this.identity.assignRole({
        customerId: employee.authSubjectId,
        role: this.loginRole(employee, phase, permanent),
        depotId: target,
        grantedBy: row.createdByRole ?? undefined,
      });
    }

    const from = employee.depotId;
    const alreadyThere = from === target;
    const data: Prisma.EmployeeUpdateInput = {};
    let move: DepotMoveWrite | undefined;
    if (!alreadyThere) {
      data.depotId = target;
      if (permanent) data.homeDepotId = target;
      if (permanent) {
        const stranded = await this.strandedDepartment(employee, target);
        if (stranded) data.departmentId = null;
      }
      move = {
        fromDepotId: from,
        toDepotId: target,
        effectiveDate: asDate(effective),
        kind: permanent ? 'PERMANENT' : phase === 'START' ? 'LOAN_START' : 'LOAN_END',
        assignmentId: row.id,
        createdBy: null,
      };
    }
    const history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput[] = alreadyThere
      ? []
      : [
          {
            changeType: 'depotId',
            fromValue: from == null ? Prisma.JsonNull : { value: from },
            toValue: { value: target },
            effectiveDate: asDate(effective),
            note: permanent ? 'Mutasi permanen terjadwal' : phase === 'START' ? 'Dipinjamkan' : 'Kembali ke depot asal',
            createdBy: null,
          },
        ];

    await this.employees.update(employee.id, data, history, move, {
      assignment: {
        id: row.id,
        data:
          phase === 'START' && !permanent
            ? { status: 'ACTIVE', appliedStartAt: now, failReason: null, ...assignmentExtra }
            : permanent
              ? { status: 'DONE', appliedStartAt: now, failReason: null, ...assignmentExtra }
              : { status: 'DONE', appliedEndAt: now, failReason: null, ...assignmentExtra },
      },
      movePendingRequestsTo: alreadyThere ? undefined : target,
    });

    // Explicit, because the global interceptor deliberately skips the sweep's own route
    // (it would write ninety-six rows a day saying nothing happened).
    await this.audit.record({
      actorId: null,
      action: `DEPOT_ASSIGNMENT_${phase}`,
      entity: 'employees',
      entityId: employee.id,
      before: { depotId: from, homeDepotId: home },
      after: { depotId: target, assignmentId: row.id, kind: row.kind, effectiveDate: effective },
      ip: null,
    });
  }

  private loginRole(employee: Employee, phase: Phase, permanent: boolean): HrManagedRole {
    const role = employee.role as string | null;
    if (!role || !(HR_MANAGED_ROLES as readonly string[]).includes(role)) {
      throw new Error('Jabatan karyawan tidak bisa dipindahkan lewat akun login');
    }
    return phase === 'START' && !permanent && role === 'KEPALA_DEPOT'
      ? 'STAFF_DEPOT'
      : (role as HrManagedRole);
  }

  /** A depot-owned department of the depot being left would strand the person in it. */
  private async strandedDepartment(employee: Employee, target: string): Promise<boolean> {
    if (!employee.departmentId || !this.departments) return false;
    const department = await this.departments.findById(employee.departmentId);
    return !!department?.depotId && department.depotId !== target;
  }

  private async fail(row: EmployeeDepotAssignment, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.warn(`depot assignment ${row.id} (${row.status}) not applied: ${reason}`);
    try {
      await this.assignments.recordFailure(
        row.id,
        reason,
        err instanceof GiveUp ? 1 : DepotAssignmentApplier.MAX_ATTEMPTS,
      );
    } catch (inner) {
      this.logger.error(`could not record the failure of ${row.id}: ${String(inner)}`);
    }
  }
}
