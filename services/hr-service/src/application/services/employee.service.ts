import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
import { SUPERVISION_PORT, SupervisionPort } from '../ports/supervision.port';
import { STAFF_IMPORT_ROLES, type EmployableRole, type HrManagedRole } from '@hydromart/access';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who to record as the author of a write.
 *
 * Every `createdBy`/`updatedBy` column is `@db.Uuid`, and the two routes auth-service calls
 * act as SYSTEM_ACTOR — whose `sub` is the string 'system'. Postgres rejects that outright,
 * so EVERY staff invite came back 500 from the one route that opens an employee record, and
 * every console switch-off did the same. The unit fakes could not see it: they push the row
 * into an array, which accepts any string.
 *
 * `null` is the honest answer, not a workaround — the columns are nullable precisely because
 * a write can come from the platform rather than from a person.
 */
function actorId(sub: string): string | null {
  return UUID.test(sub) ? sub : null;
}

/** Fields whose transitions are worth an employment-history row (status/position/salary). */
const TRACKED: readonly (keyof Employee)[] = [
  'employmentStatus',
  'position',
  'role',
  'status',
  // The last paid day belongs in the history for the same reason a salary change does:
  // it is the field a payslip dispute turns on.
  'exitDate',
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
  /**
   * Login role (jabatan). Setting it on an employee with an account re-roles the login.
   *
   * Wider than `HrManagedRole` — an account invited in the staff console may be
   * HEAD_OFFICE or FINANCE, and those people are on the payroll too — but NOT the whole
   * enum: `CUSTOMER` is excluded at the type level, because an employee record for an end
   * customer is always a mistake, and widening this to `Employee['role']` is what stopped
   * the compiler saying so. What HR may *assign* stays bounded by the DTOs on the
   * HR-facing routes, where that rule belongs.
   */
  role?: EmployableRole;
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
  /** Last paid day for a leaver arriving through an import. */
  exitDate?: string;
}

export type UpdateEmployeeInput = Omit<Partial<CreateEmployeeInput>, 'exitDate'> & {
  status?: Employee['status'];
  /** Last paid day; `null` clears it (a rehire). See `assertExitWindow`. */
  exitDate?: string | null;
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
  private readonly logger = new Logger(EmployeeService.name);

  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly repo: EmployeeRepository,
    @Inject(IDENTITY_PORT) private readonly identity: IdentityPort,
    @Optional()
    @Inject(DEPARTMENT_REPOSITORY)
    private readonly departments?: DepartmentRepository,
    // Last on purpose: every existing positional construction site keeps working. Absent,
    // the import's `atasan` column reports "not linked" instead of failing the row.
    @Optional() @Inject(SUPERVISION_PORT) private readonly supervision?: SupervisionPort,
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

  /**
   * One employee scrubbed because HQ deleted their account (Fase 6). Reports what happened
   * rather than throwing on a miss: auth-service holds identities that were never
   * employees, and deleting one of those is not a failure.
   */
  async anonymiseByAccount(authSubjectId: string): Promise<{ anonymised: number }> {
    return { anonymised: await this.repo.anonymiseByAuthSubjectId(authSubjectId) };
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

  /** Same, keyed by the login account — how a reporting line resolves now (see Fase 4). */
  findByAuthSubjectId(authSubjectId: string): Promise<Employee | null> {
    return this.repo.findByAuthSubjectId(authSubjectId);
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

  /**
   * `alreadyUnique` is for the ONE caller that has to ask first: the bulk import provisions
   * the login before writing the employee, so it runs `assertNobodyElseHas` itself, ahead of
   * auth-service (B-2). Repeating the lookup here would put back the round-trip K-4 removed,
   * on the busiest path in the service. Nobody else may pass it.
   */
  async create(
    user: AuthenticatedUser,
    input: CreateEmployeeInput,
    alreadyUnique = false,
  ): Promise<Employee> {
    // A depot-locked creator may only add staff to their own depot.
    assertDepotAccess(user, input.depotId);
    const rates = this.salaryRates(input.salaryType, input.dailyRate, input.monthlyRate);
    this.assertContractWindow(input.joinDate, input.contractEndDate);
    this.assertExitWindow(input.joinDate, input.exitDate ?? null);
    await this.assertDepartmentFits(input.departmentId, input.depotId ?? null);

    // Everything that can reject this row is asked BEFORE auth-service is called, because
    // the two writes live in two databases with no saga between them (see importMany). A
    // collision discovered after provisioning would leave a staff login nobody recorded.
    if (!alreadyUnique) await this.assertNobodyElseHas(input);
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
      exitDate: input.exitDate ? new Date(input.exitDate) : null,
      salaryType: input.salaryType,
      dailyRate: rates.dailyRate,
      monthlyRate: rates.monthlyRate,
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
      createdBy: actorId(user.sub),
      updatedBy: actorId(user.sub),
    };

    const history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput = {
      changeType: 'HIRED',
      toValue: { employmentStatus: input.employmentStatus, position: input.position },
      effectiveDate: new Date(input.joinDate),
      createdBy: actorId(user.sub),
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
   * Mint the login for an employee row that has none — the "buatkan akun" button on
   * `/hr/employees`, and the repair path for rows written before this release.
   *
   * Idempotent: an employee who already has an account is returned untouched rather than
   * given a second one.
   */
  async createAccountFor(user: AuthenticatedUser, id: string): Promise<Employee> {
    const employee = await this.getById(user, id); // 404 + depot check
    if (employee.authSubjectId) {
      return employee;
    }
    if (!employee.role) {
      throw new BadRequestException(
        'Karyawan ini belum punya jabatan. Isi jabatannya dulu, baru akunnya bisa dibuat.',
      );
    }
    const { customerId } = await this.identity.provisionManagedStaff({
      phone: employee.phone,
      role: employee.role as HrManagedRole,
      fullName: employee.fullName,
      depotId: employee.depotId ?? undefined,
    });
    return this.repo.update(id, { authSubjectId: customerId, updatedBy: actorId(user.sub) }, []);
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
    // One round-trip for both questions (K-4): this path runs once per imported row, and
    // asking twice doubled the hops on the bulk import for no new information.
    const { linked, oldestByPhone: byPhone } = await this.repo.findByAuthSubjectIdOrPhone(
      input.authSubjectId,
      input.phone,
    );
    if (linked) {
      return linked;
    }
    /*
     * A person may already be in HR from a CSV import that never linked an account; adopt
     * that row rather than minting a second one for the same phone.
     *
     * B-3, two refusals. `Employee.phone` has no `@unique` — a family shares a number — so
     * what this finds is "the oldest row with that phone", not "this person":
     *
     *  - a row already linked to a DIFFERENT account is not adopted. The write overwrote
     *    `authSubjectId`, which raises no P2002 because it is an update, so the old link
     *    vanished with nothing anywhere recording that it had existed.
     *  - a RESIGNED row is not adopted either. It produced a RESIGNED employee behind an
     *    ACTIVE login — the exact split this release exists to remove, arriving through the
     *    one path meant to fix it.
     *
     * Neither case is guessed at. Both fall through to `create`, which refuses a phone that
     * already belongs to an employee — so the invite comes back as a conflict on that one
     * row instead of silently rewiring somebody else's account. Two people on one phone is
     * ordinary; which of them an invite means is not a service's call.
     */
    if (byPhone && !byPhone.authSubjectId && byPhone.status !== 'RESIGNED') {
      return this.repo.update(
        byPhone.id,
        { authSubjectId: input.authSubjectId, role: input.role ?? byPhone.role },
        [
          {
            // Recorded, unlike before: adopting a row rewrites whose account it belongs to,
            // and the change log is the only place that can be read back afterwards.
            changeType: 'ACCOUNT_LINKED',
            toValue: { authSubjectId: input.authSubjectId, source: 'staff-invite' },
            effectiveDate: new Date(),
            createdBy: null,
          },
        ],
      );
    }
    try {
      return await this.create(SYSTEM_ACTOR, input);
    } catch (error) {
      /*
       * D-3: this route is idempotent by contract, and under concurrency it was not. Two
       * invites for the same account both miss the lookup above, and the loser hits the
       * `authSubjectId` unique index — a 400 that auth-service reports as a 503, for a row
       * that in fact exists. Re-read and hand it back: that IS the idempotent answer.
       */
      const existing = await this.repo.findByAuthSubjectId(input.authSubjectId);
      if (existing) return existing;
      throw error;
    }
  }

  /**
   * The same invite provisioning, a whole file at a time (K-4).
   *
   * Sequential on purpose: `create()` allocates the next `HR-####` by reading the highest
   * one and retrying on collision, so running rows in parallel would turn the common case
   * into the retry case. What this saves is the HTTP hop per row, not the database work —
   * auth-service made 500 of those inside one request.
   *
   * A row that throws fails only itself and its reason travels back, because the caller
   * has already minted that account and needs to say which half is missing.
   */
  async provisionManyFromInvite(
    rows: readonly (CreateEmployeeInput & { authSubjectId: string })[],
  ): Promise<{ results: { index: number; ok: boolean; message: string | null }[] }> {
    const results: { index: number; ok: boolean; message: string | null }[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        await this.provisionFromInvite(row);
        results.push({ index, ok: true, message: null });
      } catch (error) {
        results.push({ index, ok: false, message: (error as Error).message });
      }
    }
    return { results };
  }

  /**
   * The three keys that make this row somebody who already exists. Asked before the remote
   * call, so a duplicate costs a rejected form rather than an orphaned staff account.
   *
   * The wording matters: `importMany` classifies "sudah dipakai" as a duplicate row
   * (`skipped`), which is exactly what re-uploading a corrected file should produce.
   *
   * K-4: one round-trip, not three. `create()` runs this per row, and a 500-row import
   * runs `create()` 500 times — three sequential lookups there is 1500 sequential hops in
   * one request, against a baseline (S-16) of about three per row for the whole operation.
   * Which key collided still decides the message, because "sudah dipakai" with no field
   * named is a row somebody has to bisect by hand.
   */
  private async assertNobodyElseHas(input: CreateEmployeeInput): Promise<void> {
    const conflict = await this.repo.findConflicting({
      employeeCode: input.employeeCode?.trim().toUpperCase(),
      nik: input.nik?.trim(),
      phone: input.phone,
    });
    if (conflict === 'employeeCode') throw new BadRequestException('Kode karyawan sudah dipakai');
    if (conflict === 'nik') throw new BadRequestException('NIK sudah dipakai karyawan lain');
    if (conflict === 'phone') {
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
      // Only the HR form reaches here, and its DTO is bounded to HR_MANAGED_ROLES; the wider
      // enum on the input exists for accounts INVITED elsewhere, which arrive already made.
      role: input.role as HrManagedRole,
      phone: input.phone,
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
        /*
         * B-2: the uniqueness check runs BEFORE auth-service, which is the order this
         * file's own comment already claimed. `provisionStaff` promotes BY PHONE, so one
         * mistyped digit landing on somebody who already exists minted the promotion first
         * and rejected the row second — the summary said `skipped`, and a staff login
         * nobody asked for stayed.
         */
        await this.assertNobodyElseHas({ ...input, role });
        const { customerId } = await this.identity.provisionStaff({
          phone: input.phone,
          role,
          fullName: input.fullName,
          depotId: input.depotId,
        });
        // `role` is recorded on the employee too, not only on the login it just minted:
        // payroll reads the jabatan locally (KEPALA_DEPOT gets the tenure raise).
        const employee = await this.create(
          user,
          { ...input, role, authSubjectId: customerId },
          true,
        );
        return { status: 'created', id: employee.id };
      },
      /*
       * "Already linked to another employee" / "already taken" is a duplicate row, not a
       * failure — it is exactly what re-uploading a corrected file produces.
       *
       * B-2 also asked for a phone collision to be pulled out of this set. It is not, and
       * the reason is that the ordering fix above removed the harm: `skipped` was a lie
       * only because auth-service had ALREADY promoted that phone by the time this ran, so
       * "nothing happened" was false. The check now runs first and nothing is minted, so a
       * phone that already belongs to an employee really is a row that did nothing — and
       * CREATE mode's whole contract is that re-uploading a corrected file reports
       * `skipped` rather than a page of red.
       */
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
    _user: AuthenticatedUser,
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
      // Written to depot-service's supervision table, NOT to Employee.supervisorId: that
      // table is the single place a reporting line lives now, and it is the one the HQ
      // hierarchy page and the leave notifications read. Possible only because every
      // imported employee now has an account (see create()).
      const employee = await this.repo.findById(result.id);
      if (!this.supervision || !employee?.authSubjectId || !supervisor.authSubjectId) {
        result.message = `Atasan "${code}" tidak bisa ditautkan: akun login belum lengkap`;
        continue;
      }
      try {
        await this.supervision.setSuperior(employee.authSubjectId, supervisor.authSubjectId);
      } catch (err) {
        // B-9: the row message is for the person who uploaded the file, and to them every
        // failure reads the same — "atasan ditolak". A rejected cycle is their problem; a
        // 401 from an unset INTERNAL_SERVICE_KEY is not, and it printed that same sentence
        // on every row of every import forever with no other signal anywhere. The log is
        // what tells the two apart, and it is what alerting can see.
        const reason = err instanceof Error ? err.message : 'gagal';
        this.logger.error(
          `setSuperior ${employee.authSubjectId} -> ${supervisor.authSubjectId} failed: ${reason}`,
        );
        result.message = `Atasan "${code}" ditolak: ${reason}`;
      }
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
    // Touching either rate, or the type, re-shapes BOTH — a MONTHLY employee keeps no
    // stale dailyRate. Untouched, the pair is left exactly as it is.
    const rates =
      input.salaryType || input.dailyRate != null || input.monthlyRate != null
        ? this.salaryRates(salaryType, dailyRate, monthlyRate)
        : null;
    this.assertContractWindow(
      input.joinDate ?? current.joinDate.toISOString(),
      input.contractEndDate ?? current.contractEndDate?.toISOString(),
    );
    // The exit date is the one field payroll clamps the paid period to, so a typo here does
    // not read as a typo — it reads as a month of wages that never existed.
    this.assertExitWindow(
      input.joinDate ?? current.joinDate.toISOString(),
      input.exitDate === undefined ? (current.exitDate?.toISOString() ?? null) : input.exitDate,
    );
    // Re-check on a depot move too: the employee's current department may belong to the depot
    // they are leaving.
    await this.assertDepartmentFits(
      input.departmentId ?? (input.depotId ? (current.departmentId ?? undefined) : undefined),
      input.depotId ?? current.depotId,
    );

    const data: Prisma.EmployeeUpdateInput = { updatedBy: actorId(user.sub) };
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
    // Explicit null clears it: an employee who came back and still carried an exit date
    // would be paid for no days at all, and nothing on the screen would say why.
    if (input.exitDate !== undefined) {
      data.exitDate = input.exitDate === null ? null : new Date(input.exitDate);
    }
    if (input.birthDate !== undefined) data.birthDate = new Date(input.birthDate);
    if (input.contractEndDate !== undefined) {
      data.contractEndDate = new Date(input.contractEndDate);
    }
    if (input.salaryType !== undefined) data.salaryType = input.salaryType;
    if (rates) {
      data.dailyRate = rates.dailyRate;
      data.monthlyRate = rates.monthlyRate;
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

    /*
     * The name and the phone number reach the login too.
     *
     * Neither ever did, and the two failures are different sizes. A rename left the HQ
     * staff directory — which reads auth-service, not this table — showing whatever name
     * the invite was made with, forever. A corrected phone number was worse: HR showed the
     * new one and the OTP kept going to the old one, so "nomornya sudah saya betulkan" and
     * "saya tidak bisa masuk" were both true at once.
     *
     * Before the employee write, like the two pushes above: a refused number (it belongs to
     * another account) fails the whole edit rather than leaving the records disagreeing —
     * which is the very condition this closes.
     */
    const nameMoved = input.fullName !== undefined && input.fullName !== current.fullName;
    const phoneMoved = input.phone !== undefined && input.phone !== current.phone;
    if ((nameMoved || phoneMoved) && current.authSubjectId) {
      await this.identity.updateStaffProfile({
        customerId: current.authSubjectId,
        fullName: nameMoved ? input.fullName : undefined,
        phone: phoneMoved ? input.phone : undefined,
      });
    }

    // Resigning (or being made inactive) has to reach the LOGIN, or somebody who left on
    // Friday still opens the app on Monday. Same split as the depot/jabatan push above:
    // done before the employee write, so a refused call fails the edit rather than leaving
    // the two records disagreeing.
    if (input.status !== undefined && input.status !== current.status && current.authSubjectId) {
      await this.identity.setStaffActive(current.authSubjectId, input.status === 'ACTIVE');
    }

    const history = this.diffHistory(current, data, actorId(user.sub));
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
      this.diffHistory(employee, { status } as Prisma.EmployeeUpdateInput, null),
    );
    return { updated: true };
  }

  /**
   * The other direction for a depot transfer: auth-service reports that the staff console
   * moved an account to another depot, and the employee record follows.
   *
   * Writes ONLY — no push back to auth-service, same split as `setActiveInternal` above.
   *
   * Silently does nothing for an unknown account: auth-service holds identities that were
   * never employees (customers, franchise owners), and refusing those would make an
   * ordinary transfer look broken.
   *
   * REFUSES a move that would strand the employee in another depot's department. `update()`
   * checks this for every console-side edit, but that check cannot run here: an internal-key
   * route has no `AuthenticatedUser`, so `assertDepotAccess` is not in the path at all. Left
   * out, this route would be the one door into the exact inconsistency the department rule
   * exists to prevent. The refusal travels back up: auth-service pushes hard, so the console
   * transfer fails whole rather than moving the login and stranding the employee.
   */
  async setDepotInternal(authSubjectId: string, depotId: string | null): Promise<{ updated: boolean }> {
    const employee = await this.repo.findByAuthSubjectId(authSubjectId);
    if (!employee) {
      return { updated: false };
    }
    if (employee.depotId === depotId) {
      return { updated: false };
    }
    await this.assertDepartmentFits(employee.departmentId ?? undefined, depotId);
    await this.repo.update(
      employee.id,
      { depotId },
      // Actor is the staff console via auth-service, not a person this service can name.
      this.diffHistory(employee, { depotId } as Prisma.EmployeeUpdateInput, null),
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

  /**
   * DAILY needs a dailyRate (no monthlyRate); MONTHLY the reverse. Returns the pair to
   * STORE rather than only validating it, so the rule and the shaping cannot drift: the
   * two call sites used to re-derive `type === 'DAILY' ? (rate ?? null) : null` after
   * this had already proved the rate was there, and that `?? null` was unreachable code
   * sitting on the money path.
   */
  private salaryRates(
    type: SalaryType,
    dailyRate?: number,
    monthlyRate?: number,
  ): { dailyRate: number | null; monthlyRate: number | null } {
    if (type === 'DAILY') {
      if (dailyRate == null || dailyRate <= 0) {
        throw new BadRequestException('dailyRate wajib diisi untuk tipe gaji DAILY');
      }
      return { dailyRate, monthlyRate: null };
    }
    if (monthlyRate == null || monthlyRate <= 0) {
      throw new BadRequestException('monthlyRate wajib diisi untuk tipe gaji MONTHLY');
    }
    return { dailyRate: null, monthlyRate };
  }

  /**
   * A contract cannot end before it starts. Deliberately not tied to `employmentStatus`:
   * the enum has no CONTRACT value yet (that redesign is still open), so the date stands on
   * its own as a reminder for whoever renews it.
   */
  private assertExitWindow(joinDate: string, exitDate: string | null): void {
    if (exitDate && new Date(exitDate) < new Date(joinDate)) {
      throw new BadRequestException('exitDate tidak boleh sebelum joinDate');
    }
  }

  private assertContractWindow(joinDate: string, contractEndDate?: string): void {
    if (contractEndDate && new Date(contractEndDate) < new Date(joinDate)) {
      throw new BadRequestException('contractEndDate tidak boleh sebelum joinDate');
    }
  }

  /** One history row per tracked field that actually changed value. */
  private diffHistory(
    current: Employee,
    data: Prisma.EmployeeUpdateInput,
    actor: string | null,
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
