import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuthenticatedUser, ImportSummary, assertDepotAccess, depotScopeIds, runImport } from '@hydromart/platform';

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
import { STAFF_IMPORT_ROLES, type HrManagedRole } from '@hydromart/access';

/** The roles an import may mint an account for — the allowlist auth-service enforces too. */
const IMPORT_PROVISIONABLE_ROLES: readonly string[] = STAFF_IMPORT_ROLES;

/**
 * The actor behind an invite that arrived from auth-service over the internal key. Written
 * to `createdBy` so the row says where it came from, and shaped like the system principal
 * JwtAuthGuard builds for internal calls, so the depot check is the same no-op it is there.
 */
const SYSTEM_ACTOR = {
  sub: 'system',
  role: 'SUPER_ADMIN',
  phone: null,
  depotId: null,
} as unknown as AuthenticatedUser;

/** Fields whose transitions are worth an employment-history row (status/position/salary). */
const TRACKED: readonly (keyof Employee)[] = [
  'employmentStatus',
  'position',
  'role',
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
  /** Optional: staff above a single depot (Asisten SPV and up) belong to no one depot. */
  depotId?: string;
  position: string;
  /** Login role (jabatan). Setting it on an employee with an account re-roles the login. */
  role?: HrManagedRole;
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
    const depotIds = depotScopeIds(user, query.depotId);
    const { rows, total } = await this.repo.list({
      depotIds,
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
    // By-id endpoints carry no depotIds for the guard to see — enforce here (see DepotScopeGuard note).
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
    await this.assertDepartmentFits(input.departmentId, input.depotId ?? null);

    // Everything that can reject this row is asked BEFORE auth-service is called, because
    // the two writes live in two databases with no saga between them (see importMany). A
    // collision discovered after provisioning would leave a staff login nobody recorded.
    await this.assertNobodyElseHas(input);
    const authSubjectId = input.authSubjectId ?? (await this.provisionFor(input));

    const data: Omit<Prisma.EmployeeCreateInput, 'employeeCode'> = {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email ?? null,
      depotId: input.depotId ?? null,
      position: input.position,
      role: input.role ?? null,
      employmentStatus: input.employmentStatus,
      joinDate: new Date(input.joinDate),
      salaryType: input.salaryType,
      dailyRate: input.salaryType === 'DAILY' ? (input.dailyRate ?? null) : null,
      monthlyRate: input.salaryType === 'MONTHLY' ? (input.monthlyRate ?? null) : null,
      bankName: input.bankName ?? null,
      bankAccount: input.bankAccount ?? null,
      emergencyName: input.emergencyName ?? null,
      emergencyPhone: input.emergencyPhone ?? null,
      authSubjectId: authSubjectId ?? null,
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
   * The other direction of the same rule: an account invited from the HQ staff console gets
   * the employee row that makes them a person HR can see, pay and roster.
   *
   * Idempotent on `authSubjectId`: inviting the same phone twice is a promotion, never a
   * second employee. Returns the existing row untouched — the invite is not the place to
   * overwrite salary or join date somebody in HR has since corrected.
   *
   * No `AuthenticatedUser`: the caller is auth-service holding the internal key, so there is
   * no depot to check the actor against and `createdBy` is null. Every other rule (salary
   * shape, contract window, department fit, the uniqueness pre-checks) is reused as-is.
   */
  async provisionFromInvite(input: CreateEmployeeInput & { authSubjectId: string }): Promise<Employee> {
    const existing = await this.repo.findByAuthSubjectId(input.authSubjectId);
    if (existing) {
      return existing;
    }
    // A person may already be in HR from a CSV import that never linked an account; adopt
    // that row rather than minting a second one for the same phone.
    const byPhone = await this.repo.findByPhone(input.phone);
    if (byPhone) {
      return this.repo.update(
        byPhone.id,
        { authSubjectId: input.authSubjectId, role: input.role ?? byPhone.role },
        [],
      );
    }
    return this.create(SYSTEM_ACTOR, input);
  }

  /**
   * The three keys that make this row somebody who already exists. Asked before the remote
   * call, so a duplicate costs a rejected form rather than an orphaned staff account.
   *
   * The wording matters: `importMany` classifies "sudah dipakai" as a duplicate row
   * (`skipped`), which is exactly what re-uploading a corrected file should produce.
   */
  private async assertNobodyElseHas(input: CreateEmployeeInput): Promise<void> {
    const code = input.employeeCode?.trim().toUpperCase();
    if (code && (await this.repo.findByEmployeeCode(code))) {
      throw new BadRequestException('Kode karyawan sudah dipakai');
    }
    if (input.nik && (await this.repo.findByNik(input.nik.trim()))) {
      throw new BadRequestException('NIK sudah dipakai karyawan lain');
    }
    if (await this.repo.findByPhone(input.phone)) {
      throw new BadRequestException('Nomor telepon ini sudah dipakai karyawan lain');
    }
  }

  /**
   * Mint the login that makes this employee a person who can sign in — the whole point of
   * "+ Tambah" writing to two services at once.
   *
   * Fails hard (see IdentityPort): an employee row without an account is somebody who
   * cannot clock in, and nothing downstream would notice. Only the import path arrives
   * here with an account already provisioned, and it passes it in.
   */
  private async provisionFor(input: CreateEmployeeInput): Promise<string> {
    if (!input.role) {
      throw new BadRequestException('Jabatan (peran login) wajib diisi untuk karyawan baru');
    }
    const { customerId } = await this.identity.provisionManagedStaff({
      phone: input.phone,
      role: input.role,
      fullName: input.fullName,
      depotId: input.depotId,
    });
    return customerId;
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
          // An EXISTING login is deliberately left alone. Changing someone's role — what
          // they may do in 18 services — is not a side effect a spreadsheet column should
          // have. A MISSING login is a different thing entirely: the row was added by hand,
          // the person has never been able to sign in, and re-uploading the file reported
          // `updated` forever without ever fixing it.
          const link = existing.authSubjectId
            ? {}
            : await this.provisionForExisting(existing, { ...input, role });
          // employeeCode is the key we matched ON, never a field to rewrite.
          const updated = await this.update(user, existing.id, {
            ...input,
            employeeCode: undefined,
            authSubjectId: link.authSubjectId,
            // Only when the row carried no jabatan at all: that is the role the account we
            // just minted actually holds, so recording it keeps the two from disagreeing.
            role: link.authSubjectId && !existing.role ? role : undefined,
          });
          return { status: 'updated', id: updated.id, message: link.message };
        }
        const { customerId } = await this.identity.provisionStaff({
          phone: input.phone,
          role,
          fullName: input.fullName,
          depotId: input.depotId,
        });
        // `role` is recorded on the employee too, not only on the login it just minted:
        // payroll reads the jabatan locally (KEPALA_DEPOT gets the tenure raise).
        const employee = await this.create(user, { ...input, role, authSubjectId: customerId });
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

  /**
   * Mint the login an existing employee row never got, during an UPSERT import.
   *
   * The employee record decides the role, not the file: a row already carrying a jabatan
   * keeps it, and the file's column only speaks for a row that has none. A jabatan above
   * what an import may provision is reported rather than quietly downgraded — that account
   * gets made by hand in the HR form, which is the path allowed to reach those roles.
   */
  private async provisionForExisting(
    existing: Employee,
    row: { phone: string; fullName: string; depotId?: string; role: StaffRole },
  ): Promise<{ authSubjectId?: string; message?: string }> {
    const role = (existing.role as StaffRole | null) ?? row.role;
    if (!IMPORT_PROVISIONABLE_ROLES.includes(role)) {
      return {
        message: `Jabatan ${role} tidak bisa dibuatkan akun lewat impor — buat akun lewat form HR`,
      };
    }
    const { customerId } = await this.identity.provisionStaff({
      phone: row.phone,
      role,
      fullName: row.fullName,
      depotId: row.depotId,
    });
    return { authSubjectId: customerId, message: 'Akun login dibuat' };
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
      'role',
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

    // A promotion that changes the jabatan but leaves the LOGIN behind is the whole bug
    // this closes: the title said SPV while the token still said assistant. Done BEFORE
    // the employee write so a rejected re-role (auth down, role not HR-managed) fails the
    // edit outright instead of leaving the two records disagreeing.
    // A depot move counts as much as a promotion. Sent even when the jabatan is untouched:
    // leaving the account at the old depot is how a courier disappears from the dispatch
    // dropdown of the depot they were just moved to.
    const depotMoved = input.depotId !== undefined && input.depotId !== current.depotId;
    const roleMoved = input.role !== undefined && input.role !== current.role;
    if (roleMoved || depotMoved) {
      const role = (input.role ?? current.role) as HrManagedRole | null;
      if (current.authSubjectId) {
        if (!role) {
          // assignRole carries the role the token must end up with; there is none to send.
          throw new BadRequestException(
            'Karyawan ini punya akun login tapi belum punya jabatan. Isi jabatannya dulu.',
          );
        }
        await this.identity.assignRole({
          customerId: current.authSubjectId,
          role,
          depotId: input.depotId ?? current.depotId,
        });
      } else if (roleMoved && input.authSubjectId === undefined) {
        // No account to move the jabatan onto. This used to pass silently: the promotion
        // did not happen and nothing said so. It stays refused until the person has a
        // login — `/hr/employees` flags exactly these rows.
        throw new BadRequestException(
          'Karyawan ini belum punya akun login, jabatannya belum bisa diubah. Buatkan akun dulu.',
        );
      }
      // The third case — an account being LINKED in this same write — needs no push: it was
      // just minted holding this very role.
    }

    // Resigning (or being made inactive) has to reach the LOGIN, or somebody who left on
    // Friday still opens the app on Monday. Same split as the depot/jabatan push above:
    // done before the employee write, so a refused call fails the edit rather than leaving
    // the two records disagreeing.
    if (input.status !== undefined && input.status !== current.status && current.authSubjectId) {
      await this.identity.setStaffActive(current.authSubjectId, input.status === 'ACTIVE');
    }

    const history = this.diffHistory(current, data, user.sub);
    return this.repo.update(id, data, history);
  }

  /**
   * The other direction: auth-service reports a login switched off (or back on) in the
   * staff console, and the employee record follows.
   *
   * Writes ONLY — no push back to auth-service. `update()` above is the notifying half;
   * without the split, each service would answer the other's notification with one of its
   * own and the change would bounce between them forever.
   *
   * Silently does nothing for an unknown account: auth-service holds identities that were
   * never employees (customers, franchise owners), and refusing those would make an
   * ordinary suspension look broken.
   */
  async setActiveInternal(authSubjectId: string, active: boolean): Promise<{ updated: boolean }> {
    const employee = await this.repo.findByAuthSubjectId(authSubjectId);
    if (!employee) {
      return { updated: false };
    }
    const status = active ? 'ACTIVE' : 'INACTIVE';
    if (employee.status === status) {
      return { updated: false };
    }
    // RESIGNED is deliberately NOT overwritten by a plain "switch off": it carries a
    // reason the console does not know about, and INACTIVE would erase it.
    if (!active && employee.status === 'RESIGNED') {
      return { updated: false };
    }
    await this.repo.update(
      employee.id,
      { status },
      // Actor is the staff console via auth-service, not a person this service can name.
      this.diffHistory(employee, { status } as Prisma.EmployeeUpdateInput, 'system'),
    );
    return { updated: true };
  }

  /**
   * An employee always has a depot; a department may be depot-owned or network-wide. So a
   * depot-owned department only accepts staff of that same depot — otherwise a JKT clerk could
   * land in "Gudang SBY" and every depot-scoped report would count them twice.
   */
  private async assertDepartmentFits(departmentId: string | undefined, depotId: string | null) {
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
