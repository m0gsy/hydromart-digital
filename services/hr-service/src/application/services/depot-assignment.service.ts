import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuthenticatedUser, assertDepotAccess, depotScopeIds, localDayKey } from '@hydromart/platform';

import { EmployeeDepotAssignment } from '../../../prisma/generated/client';
import { HrConfigService } from '../../config/hr-config.service';
import { OpenAssignment, planProblems } from '../../domain/depot-assignment';
import { isLocalDay } from '../../domain/depot-on';
import {
  DEPOT_ASSIGNMENT_REPOSITORY,
  DepotAssignmentRepository,
} from '../ports/depot-assignment.repository';
import { DEPOT_DIRECTORY_PORT, DepotDirectoryPort } from '../ports/depot-directory.port';
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
  ) {}

  private assertEnabled(): void {
    // 404, not 403/503: to a caller the feature does not exist yet, and a 5xx here would
    // page somebody for a switch that is off on purpose.
    if (!this.config.depotAssignmentEnabled) {
      throw new NotFoundException('Penugasan lintas depot belum diaktifkan');
    }
  }

  async plan(user: AuthenticatedUser, input: PlanAssignmentInput): Promise<EmployeeDepotAssignment> {
    this.assertEnabled();
    for (const key of [input.startDate, input.endDate]) {
      if (key != null && !isLocalDay(key)) {
        throw new BadRequestException(`Tanggal tidak valid: "${key}" (format YYYY-MM-DD)`);
      }
    }
    const employee = await this.employees.getById(user, input.employeeId); // 404 + depot check
    assertDepotAccess(user, input.depotId);
    // Asked BEFORE the lock: a network call has no business inside a row-locked transaction.
    // An unreachable depot-service is a 503 (try again), never a silent yes.
    const destinationOpen = this.directory ? await this.directory.isActive(input.depotId) : true;
    const today = localDayKey(new Date(), this.config.timeZone);
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
    return this.repo.createChecked(
      {
        employeeId: employee.id,
        kind: input.kind,
        depotId: input.depotId,
        startDate: input.startDate,
        endDate: toPlan.endDate,
        createdByRole: user.role,
        createdBy: UUID.test(user.sub) ? user.sub : null,
        note: input.note ?? null,
      },
      (open) => {
        const asOpen: OpenAssignment[] = open.map((o) => ({
          id: o.id,
          kind: o.kind,
          startDate: dayOf(o.startDate),
          endDate: o.endDate ? dayOf(o.endDate) : null,
        }));
        const problems = planProblems(toPlan, subject, asOpen, today);
        if (!destinationOpen) problems.push('Depot tujuan tidak aktif (sedang ditutup).');
        if (problems.length > 0) throw new BadRequestException(problems);
      },
    );
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
    if (!cancelled) throw new ConflictException('Status penugasan berubah; muat ulang lalu coba lagi.');
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
