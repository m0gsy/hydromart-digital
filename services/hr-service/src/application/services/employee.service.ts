import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  ImportSummary,
  assertDepotAccess,
  depotScopeFilter,
  runImport,
} from '@hydromart/platform';

import {
  Employee,
  EmploymentHistory,
  Gender,
  Prisma,
  PtkpStatus,
  SalaryType,
} from '../../../prisma/generated/client';
import { DEPARTMENT_REPOSITORY, DepartmentRepository } from '../ports/department.repository';
import { EMPLOYEE_REPOSITORY, EmployeeRepository } from '../ports/employee.repository';
import { IDENTITY_PORT, IdentityPort, StaffRole } from '../ports/identity.port';

/** Fields whose transitions are worth an employment-history row (status/position/salary). */
const TRACKED: readonly (keyof Employee)[] = [
  'employmentStatus',
  'position',
  'status',
  'salaryType',
  'dailyRate',
  'monthlyRate',
  'depotId',
];

export interface CreateEmployeeInput {
  /** Supplied only by an import carrying codes from an older system; otherwise minted here. */
  employeeCode?: string;
  fullName: string;
  phone: string;
  email?: string;
  depotId: string;
  position: string;
  employmentStatus: Employee['employmentStatus'];
  joinDate: string;
  salaryType: SalaryType;
  dailyRate?: number;
  monthlyRate?: number;
  bankName?: string;
  bankAccount?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  authSubjectId?: string;
  photoUrl?: string;
  supervisorId?: string;
  shiftId?: string;
  departmentId?: string;
  npwp?: string;
  bpjsKes?: string;
  bpjsTk?: string;
  nik?: string;
  birthDate?: string;
  gender?: Gender;
  address?: string;
  ptkpStatus?: PtkpStatus;
  contractEndDate?: string;
}

export type UpdateEmployeeInput = Partial<CreateEmployeeInput> & {
  status?: Employee['status'];
};

/**
 * One CSV row: the employee fields plus the login role to provision for them. The
 * supervisor arrives as a staff code, not a UUID — nobody types a UUID into a spreadsheet,
 * and the person it points at may not exist until later in the same file.
 */
export type ImportEmployeeInput = Omit<CreateEmployeeInput, 'authSubjectId'> & {
  role: StaffRole;
  supervisorCode?: string;
};

/**
 * CREATE refuses to touch anyone who already exists (a re-upload reports `skipped`);
 * UPSERT overwrites them. Overwriting is opt-in per upload because it is the one mode that
 * can quietly wipe a correct salary with a stale spreadsheet column.
 */
export type ImportMode = 'CREATE' | 'UPSERT';

@Injectable()
export class EmployeeService {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly repo: EmployeeRepository,
    @Inject(IDENTITY_PORT) private readonly identity: IdentityPort,
    @Optional()
    @Inject(DEPARTMENT_REPOSITORY)
    private readonly departments?: DepartmentRepository,
  ) {}

  /**
   * Retention report (M23-21). Counts departed records past their window and deletes
   * nothing — the number goes to a human, who decides. Automatic deletion is not wired
   * on purpose: attendance and payroll rows reference an employee, so removing one is a
   * cascade decision, not a sweep.
   */
  async retentionReport(cutoff: Date): Promise<{ eligible: number }> {
    return { eligible: await this.repo.countRetentionEligible(cutoff) };
  }

  /**
   * Retention enforcement. Departed records lose their identity and their non-financial
   * detail; payroll keeps its numbers without an owner, because it is proof that wages
   * were paid. Same shape as the customer decision in item 13 — one pattern, not two.
   */
  async retentionAnonymise(cutoff: Date): Promise<{ deleted: number }> {
    return { deleted: await this.repo.anonymiseRetentionEligible(cutoff) };
  }

  /** Biometric purge on its own short window. */
  async purgeBiometrics(cutoff: Date): Promise<{ deleted: number }> {
    return { deleted: await this.repo.purgeFaceEmbeddings(cutoff) };
  }

  async list(
    user: AuthenticatedUser,
    query: {
      depotId?: string;
      status?: Employee['status'];
      departmentId?: string;
      search?: string;
      page: number;
      pageSize: number;
    },
  ): Promise<{ rows: Employee[]; total: number; page: number; pageSize: number }> {
    // Depot-locked roles (operator/manager) are forced to their own depot; HQ sees all.
    const depotId = depotScopeFilter(user, query.depotId);
    const { rows, total } = await this.repo.list({
      depotId,
      status: query.status,
      departmentId: query.departmentId,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { rows, total, page: query.page, pageSize: query.pageSize };
  }

  async getById(user: AuthenticatedUser, id: string): Promise<Employee> {
    const employee = await this.repo.findById(id);
    if (!employee) {
      throw new NotFoundException('Karyawan tidak ditemukan');
    }
    // By-id endpoints carry no depotId for the guard to see — enforce here (see DepotScopeGuard note).
    assertDepotAccess(user, employee.depotId);
    return employee;
  }

  /**
   * Plain read with no depot check, for service-to-service lookups inside this service —
   * e.g. resolving a supervisor to notify. Never expose it on a controller: the depot gate
   * lives in getById.
   */
  findByIdInternal(id: string): Promise<Employee | null> {
    return this.repo.findById(id);
  }

  /** Resolve the caller's OWN employee record via the linked auth account (self-service). */
  async getSelf(user: AuthenticatedUser): Promise<Employee> {
    const employee = await this.repo.findByAuthSubjectId(user.sub);
    if (!employee) {
      throw new NotFoundException('Akun ini belum tertaut ke data karyawan');
    }
    return employee;
  }

  async getHistory(user: AuthenticatedUser, id: string): Promise<EmploymentHistory[]> {
    await this.getById(user, id); // 404 + depot check
    return this.repo.listHistory(id);
  }

  async create(user: AuthenticatedUser, input: CreateEmployeeInput): Promise<Employee> {
    // A depot-locked creator may only add staff to their own depot.
    assertDepotAccess(user, input.depotId);
    this.assertSalaryShape(input.salaryType, input.dailyRate, input.monthlyRate);
    this.assertContractWindow(input.joinDate, input.contractEndDate);
    await this.assertDepartmentFits(input.departmentId, input.depotId);

    const data: Omit<Prisma.EmployeeCreateInput, 'employeeCode'> = {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email ?? null,
      depotId: input.depotId,
      position: input.position,
      employmentStatus: input.employmentStatus,
      joinDate: new Date(input.joinDate),
      salaryType: input.salaryType,
      dailyRate: input.salaryType === 'DAILY' ? (input.dailyRate ?? null) : null,
      monthlyRate: input.salaryType === 'MONTHLY' ? (input.monthlyRate ?? null) : null,
      bankName: input.bankName ?? null,
      bankAccount: input.bankAccount ?? null,
      emergencyName: input.emergencyName ?? null,
      emergencyPhone: input.emergencyPhone ?? null,
      authSubjectId: input.authSubjectId ?? null,
      photoUrl: input.photoUrl ?? null,
      supervisorId: input.supervisorId ?? null,
      shiftId: input.shiftId ?? null,
      departmentId: input.departmentId ?? null,
      npwp: input.npwp ?? null,
      bpjsKes: input.bpjsKes ?? null,
      bpjsTk: input.bpjsTk ?? null,
      nik: input.nik ?? null,
      birthDate: input.birthDate ? new Date(input.birthDate) : null,
      gender: input.gender ?? null,
      address: input.address ?? null,
      ptkpStatus: input.ptkpStatus ?? null,
      contractEndDate: input.contractEndDate ? new Date(input.contractEndDate) : null,
      createdBy: user.sub,
      updatedBy: user.sub,
    };

    const history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput = {
      changeType: 'HIRED',
      toValue: { employmentStatus: input.employmentStatus, position: input.position },
      effectiveDate: new Date(input.joinDate),
      createdBy: user.sub,
    };

    // Sequential code (HR-0001). ponytail: retry on the unique-collision from a concurrent
    // create rather than a DB sequence; internal HR volume is low, add a sequence only if it bites.
    const supplied = input.employeeCode?.trim().toUpperCase();
    for (let attempt = 0; attempt < 5; attempt++) {
      const employeeCode =
        supplied ?? `HR-${String((await this.repo.count()) + 1 + attempt).padStart(4, '0')}`;
      try {
        return await this.repo.create({ ...data, employeeCode }, history);
      } catch (err) {
        if (this.isUniqueViolation(err, 'nik')) {
          throw new BadRequestException('NIK sudah dipakai karyawan lain');
        }
        if (this.isUniqueViolation(err, 'employeeCode')) {
          // A code the file supplied is a fact about the row, not a collision to retry past:
          // minting HR-0042 for a row that said "STAFF-7" would silently invent a code.
          if (supplied) throw new BadRequestException('Kode karyawan sudah dipakai');
          if (attempt < 4) continue;
        }
        if (this.isUniqueViolation(err, 'authSubjectId')) {
          throw new BadRequestException('Akun ini sudah tertaut ke karyawan lain');
        }
        throw err;
      }
    }
    /* istanbul ignore next — loop always returns or throws above */
    throw new BadRequestException('Gagal membuat kode karyawan, coba lagi');
  }

  /**
   * Bulk import (CSV wizard). Each row is independent: it provisions the login account
   * first, then writes the employee, and a failure stops only that row. There is no
   * cross-row transaction on purpose — the write spans two services, and an admin
   * operation that can simply be re-run doesn't warrant a saga. Re-running is safe:
   * `authSubjectId` is unique, so a row already imported comes back as `skipped`.
   */
  async importMany(
    user: AuthenticatedUser,
    rows: ImportEmployeeInput[],
    mode: ImportMode = 'CREATE',
  ): Promise<ImportSummary> {
    const summary = await runImport(
      rows,
      async ({ role, supervisorCode: _supervisorCode, ...input }) => {
        const existing = mode === 'UPSERT' ? await this.findForUpsert(input) : null;
        if (existing) {
          // The login is deliberately left alone. The account already exists, and changing
          // someone's role — what they may do in 18 services — is not a side effect a
          // spreadsheet column should have.
          // employeeCode is the key we matched ON, never a field to rewrite.
          const updated = await this.update(user, existing.id, {
            ...input,
            employeeCode: undefined,
          });
          return { status: 'updated', id: updated.id };
        }
        const { customerId } = await this.identity.provisionStaff({
          phone: input.phone,
          role,
          fullName: input.fullName,
          depotId: input.depotId,
        });
        const employee = await this.create(user, { ...input, authSubjectId: customerId });
        return { status: 'created', id: employee.id };
      },
      // "Already linked to another employee" / "code already taken" is a duplicate row, not a
      // failure — it is exactly what re-uploading a corrected file produces.
      (err) =>
        err instanceof BadRequestException && /tertaut|sudah dipakai/.test(String(err.message)),
    );
    await this.linkSupervisors(user, rows, summary);
    return summary;
  }

  /** Upsert match, most specific key first. Phone last: it is the only non-unique one. */
  private async findForUpsert(input: {
    employeeCode?: string;
    nik?: string;
    phone: string;
  }): Promise<Employee | null> {
    const code = input.employeeCode?.trim().toUpperCase();
    if (code) return this.repo.findByEmployeeCode(code);
    if (input.nik) return this.repo.findByNik(input.nik.trim());
    return this.repo.findByPhone(input.phone);
  }

  /**
   * Second pass, because an employee's supervisor is very often further down the same file —
   * resolving during row 3 would fail on a manager who only appears at row 40.
   */
  private async linkSupervisors(
    user: AuthenticatedUser,
    rows: ImportEmployeeInput[],
    summary: ImportSummary,
  ): Promise<void> {
    for (const [index, row] of rows.entries()) {
      const code = row.supervisorCode?.trim().toUpperCase();
      const result = summary.results[index];
      if (!code || !result?.id) continue;
      const supervisor = await this.repo.findByEmployeeCode(code);
      if (!supervisor) {
        // The employee row itself is sound; it is the pointer that dangles. Saying so beats
        // rolling a good row back to `failed` over one bad cell.
        result.message = `Atasan "${code}" tidak ditemukan, kolom atasan dikosongkan`;
        continue;
      }
      await this.repo.update(result.id, { supervisorId: supervisor.id, updatedBy: user.sub }, []);
    }
  }

  /** Resolve the staff code an import row carries into a row this caller may touch. */
  async getByCode(user: AuthenticatedUser, employeeCode: string): Promise<Employee> {
    const employee = await this.repo.findByEmployeeCode(employeeCode.trim().toUpperCase());
    if (!employee) {
      throw new BadRequestException(`Kode karyawan "${employeeCode}" tidak ditemukan`);
    }
    assertDepotAccess(user, employee.depotId);
    return employee;
  }

  async update(user: AuthenticatedUser, id: string, input: UpdateEmployeeInput): Promise<Employee> {
    const current = await this.getById(user, id); // 404 + depot check
    // Block moving an employee into a depot the caller can't touch.
    if (input.depotId) {
      assertDepotAccess(user, input.depotId);
    }

    const salaryType = input.salaryType ?? current.salaryType;
    const dailyRate =
      input.dailyRate ?? (current.dailyRate ? Number(current.dailyRate) : undefined);
    const monthlyRate =
      input.monthlyRate ?? (current.monthlyRate ? Number(current.monthlyRate) : undefined);
    if (input.salaryType || input.dailyRate != null || input.monthlyRate != null) {
      this.assertSalaryShape(salaryType, dailyRate, monthlyRate);
    }
    this.assertContractWindow(
      input.joinDate ?? current.joinDate.toISOString(),
      input.contractEndDate ?? current.contractEndDate?.toISOString(),
    );
    // Re-check on a depot move too: the employee's current department may belong to the depot
    // they are leaving.
    await this.assertDepartmentFits(
      input.departmentId ?? (input.depotId ? (current.departmentId ?? undefined) : undefined),
      input.depotId ?? current.depotId,
    );

    const data: Prisma.EmployeeUpdateInput = { updatedBy: user.sub };
    for (const key of [
      'fullName',
      'phone',
      'email',
      'position',
      'employmentStatus',
      'depotId',
      'bankName',
      'bankAccount',
      'emergencyName',
      'emergencyPhone',
      'authSubjectId',
      'photoUrl',
      'supervisorId',
      'shiftId',
      'departmentId',
      'npwp',
      'bpjsKes',
      'bpjsTk',
      'nik',
      'gender',
      'address',
      'ptkpStatus',
      'status',
    ] as const) {
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    }
    if (input.joinDate !== undefined) data.joinDate = new Date(input.joinDate);
    if (input.birthDate !== undefined) data.birthDate = new Date(input.birthDate);
    if (input.contractEndDate !== undefined) {
      data.contractEndDate = new Date(input.contractEndDate);
    }
    if (input.salaryType !== undefined) data.salaryType = input.salaryType;
    if (input.salaryType || input.dailyRate != null || input.monthlyRate != null) {
      data.dailyRate = salaryType === 'DAILY' ? (dailyRate ?? null) : null;
      data.monthlyRate = salaryType === 'MONTHLY' ? (monthlyRate ?? null) : null;
    }

    const history = this.diffHistory(current, data, user.sub);
    return this.repo.update(id, data, history);
  }

  /**
   * An employee always has a depot; a department may be depot-owned or network-wide. So a
   * depot-owned department only accepts staff of that same depot — otherwise a JKT clerk could
   * land in "Gudang SBY" and every depot-scoped report would count them twice.
   */
  private async assertDepartmentFits(departmentId: string | undefined, depotId: string) {
    if (!departmentId || !this.departments) return;
    const department = await this.departments.findById(departmentId);
    if (!department) throw new BadRequestException('Departemen tidak ditemukan');
    if (department.depotId && department.depotId !== depotId) {
      throw new BadRequestException(`Departemen ${department.code} milik depot lain`);
    }
  }

  /** DAILY needs a dailyRate (no monthlyRate); MONTHLY the reverse. */
  private assertSalaryShape(type: SalaryType, dailyRate?: number, monthlyRate?: number): void {
    if (type === 'DAILY' && (dailyRate == null || dailyRate <= 0)) {
      throw new BadRequestException('dailyRate wajib diisi untuk tipe gaji DAILY');
    }
    if (type === 'MONTHLY' && (monthlyRate == null || monthlyRate <= 0)) {
      throw new BadRequestException('monthlyRate wajib diisi untuk tipe gaji MONTHLY');
    }
  }

  /**
   * A contract cannot end before it starts. Deliberately not tied to `employmentStatus`:
   * the enum has no CONTRACT value yet (that redesign is still open), so the date stands on
   * its own as a reminder for whoever renews it.
   */
  private assertContractWindow(joinDate: string, contractEndDate?: string): void {
    if (contractEndDate && new Date(contractEndDate) < new Date(joinDate)) {
      throw new BadRequestException('contractEndDate tidak boleh sebelum joinDate');
    }
  }

  /** One history row per tracked field that actually changed value. */
  private diffHistory(
    current: Employee,
    data: Prisma.EmployeeUpdateInput,
    actor: string,
  ): Prisma.EmploymentHistoryCreateWithoutEmployeeInput[] {
    const rows: Prisma.EmploymentHistoryCreateWithoutEmployeeInput[] = [];
    for (const field of TRACKED) {
      const next = (data as Record<string, unknown>)[field];
      if (next === undefined) continue;
      const before = current[field];
      // Decimal/Date compare by string so a value-equal update logs nothing.
      if (before != null && String(before) === String(next)) continue;
      if (before == null && next == null) continue;
      rows.push({
        changeType: String(field),
        fromValue: before == null ? Prisma.JsonNull : { value: String(before) },
        toValue: next == null ? Prisma.JsonNull : { value: String(next) },
        effectiveDate: new Date(),
        createdBy: actor,
      });
    }
    return rows;
  }

  private isUniqueViolation(err: unknown, field: string): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' &&
      (err.meta?.target as string[] | undefined)?.includes(field) === true
    );
  }
}
