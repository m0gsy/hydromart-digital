import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  CustomerNotFoundError,
  DriverRosterTooLargeError,
  EmailAlreadyRegisteredError,
  InvalidStaffRoleError,
  RoleEscalationError,
  PhoneAlreadyRegisteredError,
  StaffDepotRequiredError,
} from '../../domain/errors/auth.errors';
// The locked-role set is the guards' own definition, imported rather than mirrored: the
// two Role enums carry identical string values, so the cast is a type bridge, not a
// second source of truth.
import { ImportSummary, isDepotLocked, Role as PlatformRole, runImport } from '@hydromart/platform';
import { canGrantRole } from '@hydromart/access';

import { Role } from '../../domain/customer/role.enum';
import { CustomerStatus } from '../../domain/customer/customer-status.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { CustomerRepository } from '../ports/customer.repository';
import { HR_DIRECTORY_PORT, HrDirectoryPort, ProvisionEmployeeInput } from '../ports/hr-directory.port';
import { AUTH_TOKENS } from '../tokens';
import { PublicCustomer, RequestContext, toPublicCustomer } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { SessionInfo, SessionService } from './session.service';

/**
 * Ceiling on the dispatch driver roster (K-3). Far above any real depot and above the
 * whole network's couriers today; it exists so an unbounded read cannot pull the staff
 * table into one response, not to bound normal use.
 */
const MAX_DRIVERS = 2_000;

/** One row of a bulk staff invite — the same fields the single invite takes. */
export interface ImportStaffRow extends InviteStaffInput {}

/**
 * A console invite: the account fields, plus the employment ones hr-service needs to open
 * an employee record for the same person.
 */
export interface InviteStaffInput {
  phone: string;
  role: Role;
  fullName?: string;
  depotId?: string;
  vehicleType?: string;
  plateNumber?: string;
  position: string;
  joinDate: string;
  employmentStatus: string;
  salaryType: string;
  dailyRate?: number;
  monthlyRate?: number;
}

/** Account self-service: profile, active sessions, and logout-everywhere (FR-009/010). */
@Injectable()
export class AccountService {
  constructor(
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    // Optional so every existing construction site (and every spec that does not exercise
    // the invite path) keeps working; the console path refuses rather than skipping it.
    @Optional() @Inject(HR_DIRECTORY_PORT) private readonly hr?: HrDirectoryPort,
  ) {}

  async getProfile(customerId: string): Promise<PublicCustomer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }
    return toPublicCustomer(customer);
  }

  /**
   * The depot a staff-facing read must be narrowed to, decided from the CALLER — never from
   * the query alone.
   *
   * - depot-locked roles (kepala depot, depot staff) and depot managers: their own depot, and
   *   asking for another one is refused rather than silently rewritten.
   * - everyone else (head office, super admin, finance): whatever they asked for.
   *
   * Lives here rather than in a controller because two controllers need the same answer and
   * only one of them had it: `GET /auth/audit/depot` took `depotId` straight off the query with
   * no ownership check anywhere on the path, so a depot-locked KEPALA_DEPOT could read another
   * depot's privileged-action trail — actor ids and staff actions — by changing one UUID. Its
   * siblings `/auth/staff` and `/auth/drivers` were narrowing correctly the whole time, which
   * is what makes that an omission rather than a decision.
   */
  async resolveScopedDepot(
    user: { sub: string; role: string; depotIds?: readonly string[] },
    requested?: string,
  ): Promise<string | undefined> {
    // A MANAGER's depots come from the hierarchy (supervision chain + direct grants),
    // resolved once per request by DepotScopeGuard — they do NOT sit in this service's
    // `assignedDepotId` column, which is a depot-locked account's home depot. Reading that
    // column for a manager asked the wrong table: every manager scoped the platform's own
    // way answered 403 here while every other service accepted them, so `/auth/staff` and
    // `/auth/drivers` were empty on a console that had already drawn the screen.
    if (user.role === Role.MANAGER) {
      // MANAGER is a depot-RESOLVED role, so DepotScopeGuard always leaves an array here on
      // an authenticated route — possibly empty. `undefined` therefore means the guard did
      // not run, and the fail-closed reading is the only safe one: returning `requested`
      // would hand a manager every depot in the network the day someone forgets the guard.
      const scope = user.depotIds ?? [];
      if (requested) {
        if (!scope.includes(requested)) {
          throw new ForbiddenException('Akun ini hanya boleh melihat data depot yang ditugaskan padanya.');
        }
        return requested;
      }
      if (scope.length === 1) return scope[0];
      if (scope.length === 0) {
        throw new ForbiddenException('Akun ini hanya boleh melihat data depot yang ditugaskan padanya.');
      }
      // Several depots and no choice made. Refusing names the fix; returning `undefined`
      // would quietly widen the read to every depot in the network.
      throw new ForbiddenException(
        'Akun ini menaungi beberapa depot — sebutkan depotId yang ingin dibaca.',
      );
    }
    if (!isDepotLocked(user.role as unknown as PlatformRole)) return requested;
    const self = await this.getProfile(user.sub);
    if (!self.assignedDepotId || (requested && requested !== self.assignedDepotId)) {
      throw new ForbiddenException('Akun ini hanya boleh melihat data depot yang ditugaskan padanya.');
    }
    return self.assignedDepotId;
  }

  /**
   * Staff lookup of a customer by exact phone (for voucher grant). Normalizes the
   * input to the same E.164 form registration stores, so `0812…`/`+62…`/`62…` all
   * resolve. Throws CustomerNotFoundError (404) when no account matches.
   */
  async lookupByPhone(rawPhone: string): Promise<PublicCustomer> {
    const phone = PhoneNumber.create(rawPhone).value;
    const customer = await this.customers.findByPhone(phone);
    if (!customer) {
      throw new CustomerNotFoundError();
    }
    return toPublicCustomer(customer);
  }

  /**
   * Resolve a batch of customer ids to their public profiles (reseller-name display).
   * Deduplicates, caps the batch, and silently drops ids with no account — callers only
   * need names for the ids they already hold, order is not guaranteed.
   */
  async lookupByIds(ids: string[]): Promise<PublicCustomer[]> {
    const unique = [...new Set(ids.filter((id) => id.length > 0))].slice(0, 200);
    if (unique.length === 0) return [];
    const customers = await this.customers.findByIds(unique);
    return customers.map(toPublicCustomer);
  }

  /**
   * Update the caller's own name and/or email (FR-009). Email is unique across
   * accounts; a normalized-lowercase pre-check rejects a collision before the
   * write (the repository translates a P2002 race into the same error).
   */
  async updateProfile(
    customerId: string,
    changes: { fullName?: string | null; email?: string | null },
  ): Promise<PublicCustomer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }

    let email = changes.email;
    if (email !== undefined && email !== null) {
      email = email.trim().toLowerCase();
      const existing = await this.customers.findByEmail(email);
      if (existing && existing.id !== customerId) {
        throw new EmailAlreadyRegisteredError();
      }
    }

    customer.updateProfile(changes.fullName, email);
    const saved = await this.customers.save(customer);
    return toPublicCustomer(saved);
  }

  /** Staff directory (PRD Module 7): non-customer accounts, paginated, optional role filter. */
  async listStaff(
    page: number,
    limit: number,
    role?: Role,
    depotId?: string,
    search?: string,
  ): Promise<{ items: PublicCustomer[]; total: number; page: number; limit: number }> {
    const { items, total } = await this.customers.listStaff(page, limit, role, depotId, search);
    return { items: items.map(toPublicCustomer), total, page, limit };
  }

  /** HQ overview KPI: new end-customer signups in an optional [from, to) window. */
  async countNewCustomers(from?: Date, to?: Date): Promise<number> {
    return this.customers.countCustomersCreated(from, to);
  }

  /**
   * Driver roster for dispatch (feature 9b): active couriers only, so staff can
   * pick one by name. Reuses the staff-directory query with a STAFF_DEPOT filter and
   * keeps only ACTIVE accounts.
   *
   * `depotId` is what keeps a dispatcher at depot A from assigning a courier who belongs
   * to depot B — the controller decides it from the caller, never the client. Omitted only
   * for HQ, which legitimately sees the whole network.
   *
   * Paged to exhaustion rather than one 500-row page: a truncated roster made driver 501
   * undispatchable and said nothing about it.
   */
  async listDrivers(depotId?: string): Promise<PublicCustomer[]> {
    // K-3. Page at the same 100 `ListStaffQueryDto` caps the HTTP route at: reading the
    // repository directly used to bypass that `@Max(100)` entirely, at 200 a page and with
    // no ceiling at all. Not `readAllPages`, which is keyset — the staff directory is
    // offset-paged, and giving it a cursor read would be a new repository method for the
    // same guarantee. What matters is main's rule, and this keeps it: bounded pages, and a
    // ceiling that REFUSES instead of returning a short roster that looks complete.
    const PAGE = 100;
    const drivers: PublicCustomer[] = [];
    for (let page = 1; ; page += 1) {
      const { items, total } = await this.customers.listStaff(page, PAGE, Role.STAFF_DEPOT, depotId);
      drivers.push(...items.map(toPublicCustomer));
      if (items.length === 0 || drivers.length >= total) break;
      if (drivers.length >= MAX_DRIVERS) throw new DriverRosterTooLargeError(MAX_DRIVERS);
    }
    return drivers.filter((c) => c.status === CustomerStatus.ACTIVE);
  }

  /**
   * F8. The account ids of the ACTIVE staff at one depot — the people an operational alert
   * about that depot is for.
   *
   * Ops alerts (stock low, stock untracked, meter variance, a HIGH-severity courier
   * incident) went to a phone number and carried `customerId: null`, so crm skipped push
   * entirely: they had no channel that could wake anybody. crm has no depot-to-staff map of
   * its own and should not grow one — the roster lives here.
   *
   * Ids only, on purpose: crm needs somewhere to send a push, not a staff directory. The
   * same bounded paging as `listDrivers`, and the same refusal rather than a short list
   * that looks complete.
   */
  async staffIdsForDepot(depotId: string): Promise<string[]> {
    const PAGE = 100;
    const ids: string[] = [];
    let seen = 0;
    for (let page = 1; ; page += 1) {
      const { items, total } = await this.customers.listStaff(page, PAGE, undefined, depotId);
      seen += items.length;
      for (const c of items) {
        if (c.status === CustomerStatus.ACTIVE) ids.push(c.id);
      }
      if (items.length === 0 || seen >= total) break;
      if (seen >= MAX_DRIVERS) throw new DriverRosterTooLargeError(MAX_DRIVERS);
    }
    return ids;
  }

  /**
   * Invite a staff member by phone (PRD Module 7). Promotes an existing account to
   * the given staff role, or creates a new pre-activated account if the phone is
   * unknown (they sign in by phone OTP). The role must not be CUSTOMER.
   */
  async inviteStaff(
    rawPhone: string,
    role: Role,
    fullName?: string | null,
    depotId?: string | null,
    vehicle?: { vehicleType?: string | null; plateNumber?: string | null },
    grantedBy?: Role,
  ): Promise<PublicCustomer> {
    return (await this.inviteStaffDetailed(rawPhone, role, fullName, depotId, vehicle, grantedBy))
      .staff;
  }

  /**
   * `inviteStaff`, plus whether the account was created or an existing one promoted.
   *
   * The bulk import needs that verdict and used to get it by asking `findByPhone` itself,
   * immediately before this method asked the same question again (K-4). One lookup, one
   * answer; the public `inviteStaff` above keeps its old shape.
   */
  private async inviteStaffDetailed(
    rawPhone: string,
    role: Role,
    fullName?: string | null,
    depotId?: string | null,
    vehicle?: { vehicleType?: string | null; plateNumber?: string | null },
    grantedBy?: Role,
  ): Promise<{ staff: PublicCustomer; created: boolean }> {
    if (role === Role.CUSTOMER) {
      throw new InvalidStaffRoleError();
    }
    // AUTHZ-1. Checked here, on the one write path both the console invite and the bulk
    // import funnel through, so the spreadsheet cannot be the way around it.
    if (!canGrantRole(grantedBy, role)) {
      throw new RoleEscalationError(role);
    }
    // Depot-locked roles are unusable without a depot (see StaffDepotRequiredError).
    // Enforced here rather than in each DTO because the console invite and the hr-service
    // bulk import both funnel through this one write path.
    if (isDepotLocked(role as unknown as PlatformRole) && (depotId ?? '') === '') {
      throw new StaffDepotRequiredError();
    }
    // Vehicle info only applies to couriers; ignore it for other roles.
    const vehicleType = role === Role.STAFF_DEPOT ? vehicle?.vehicleType : undefined;
    const plateNumber = role === Role.STAFF_DEPOT ? vehicle?.plateNumber : undefined;
    const phone = PhoneNumber.create(rawPhone).value;
    const existing = await this.customers.findByPhone(phone);
    if (existing) {
      existing.promoteToStaff(role, depotId);
      if (fullName !== undefined && fullName !== null && fullName !== '') {
        existing.updateProfile(fullName, undefined);
      }
      existing.setVehicle(vehicleType, plateNumber);
      return { staff: toPublicCustomer(await this.customers.save(existing)), created: false };
    }
    const created = await this.customers.create({
      phone,
      email: null,
      fullName: fullName ?? null,
      role,
      assignedDepotId: depotId ?? null,
      vehicleType: vehicleType ?? null,
      plateNumber: plateNumber ?? null,
    });
    // create() defaults the account to PENDING; activate it so the invitee can sign in.
    created.promoteToStaff(role, depotId);
    return { staff: toPublicCustomer(await this.customers.save(created)), created: true };
  }

  /**
   * The staff console inviting somebody: the account, and then the employee record that
   * makes them payable, rosterable and able to clock in.
   *
   * Deliberately NOT folded into `inviteStaff`. That one is also what hr-service calls over
   * the internal key while it is creating an employee — pushing back to hr-service from
   * there would either loop or write the employee twice. This is the console's entry point;
   * `inviteStaff` stays the plain account write.
   *
   * FRANCHISE_OWNER is skipped: an owner is a business counterpart, not somebody on the
   * payroll, and giving them an employee row would put them in headcount and rosters.
   *
   * Account first, then hr-service, because the employee row needs the account id. A failure
   * in between leaves an account with no employee — visible as such in the Fase 5
   * reconciliation rather than silently.
   */
  async inviteStaffWithEmployee(
    input: InviteStaffInput,
    grantedBy?: Role,
  ): Promise<PublicCustomer> {
    const staff = await this.inviteStaff(
      input.phone,
      input.role,
      input.fullName,
      input.depotId,
      { vehicleType: input.vehicleType, plateNumber: input.plateNumber },
      grantedBy,
    );
    /*
     * D-4: the skip is on the INPUT role here and on the STORED role at status and delete.
     * Re-inviting somebody who is already an employee AS a franchise owner therefore skipped
     * provisioning and left their old employee row behind — active, unreachable from the
     * console, and with no repair path. Their record is closed instead, by the same internal
     * route a resignation uses: an owner is a counterparty, so the employee half must end.
     */
    if (input.role === Role.FRANCHISE_OWNER) {
      if (this.hr) {
        await this.hr
          .setEmployeeActive(staff.id, false)
          .catch(() => undefined /* nothing to close, or hr is down — see below */);
      }
      return staff;
    }
    if (!this.hr) {
      throw new ServiceUnavailableException(
        'hr-service belum dikonfigurasi; undangan staf tidak bisa diproses.',
      );
    }
    await this.hr.provisionEmployee(AccountService.provisionPayload(staff, input));
    return staff;
  }

  /** The employee half of an invite, shaped once for both the single and the bulk path. */
  private static provisionPayload(
    staff: PublicCustomer,
    input: InviteStaffInput,
  ): ProvisionEmployeeInput {
    return {
      authSubjectId: staff.id,
      fullName: staff.fullName ?? input.fullName ?? input.phone,
      phone: staff.phone,
      role: input.role,
      depotId: input.depotId ?? undefined,
      position: input.position,
      joinDate: input.joinDate,
      employmentStatus: input.employmentStatus,
      salaryType: input.salaryType,
      dailyRate: input.dailyRate,
      monthlyRate: input.monthlyRate,
    };
  }

  /**
   * Bulk staff invite (HQ spreadsheet wizard). Every row goes through `inviteStaff`, so an
   * uploaded file has exactly the powers and exactly the validation of the single-invite
   * form — a bad role, a missing depot or an unparseable phone fails THAT row and the rest
   * of the file still lands.
   *
   * Re-uploading is safe and is the expected way to fix a file: a phone that already holds
   * an account is promoted, not duplicated, and comes back as `updated` rather than
   * `created` so the summary tells the truth about what the second run actually did.
   */
  async importStaff(rows: readonly ImportStaffRow[], grantedBy?: Role): Promise<ImportSummary> {
    // K-4, two phases. The accounts still go one at a time — each is its own write and its
    // own per-row verdict — but the employee half now leaves in ONE call instead of one per
    // row. A 500-row file used to make 500 sequential HTTP hops to hr-service inside a
    // single request; the baseline (S-16) for a bulk import is about three round-trips a row
    // for everything, and that alone was already over it.
    const pending: { row: number; payload: ProvisionEmployeeInput }[] = [];

    const summary = await runImport(rows, async (row, index) => {
      const { staff, created } = await this.inviteStaffDetailed(
        row.phone,
        row.role,
        row.fullName,
        row.depotId,
        { vehicleType: row.vehicleType, plateNumber: row.plateNumber },
        grantedBy,
      );
      // An owner is a business counterpart, not headcount — same skip as the single invite.
      if (row.role !== Role.FRANCHISE_OWNER) {
        if (!this.hr) {
          throw new ServiceUnavailableException(
            'hr-service belum dikonfigurasi; undangan staf tidak bisa diproses.',
          );
        }
        pending.push({ row: index + 1, payload: AccountService.provisionPayload(staff, row) });
      }
      return { status: created ? 'created' : 'updated', id: staff.id };
    });

    if (pending.length > 0) {
      await this.applyBulkProvisioning(summary, pending);
    }
    return summary;
  }

  /**
   * Send the employee halves in one call and fold the per-row verdicts back into the summary.
   *
   * A row whose employee record failed is downgraded to `failed` even though its account was
   * created: that is the half-a-person state this release exists to stop, and reporting it as
   * `created` would hide exactly the rows somebody has to go and finish by hand.
   *
   * A call that does not land at all fails every pending row for the same reason.
   */
  private async applyBulkProvisioning(
    summary: ImportSummary,
    pending: { row: number; payload: ProvisionEmployeeInput }[],
  ): Promise<void> {
    const fail = (row: number, message: string): void => {
      const result = summary.results.find((r) => r.row === row);
      if (!result || result.status === 'failed') return;
      if (result.status === 'created') summary.created -= 1;
      if (result.status === 'updated') summary.updated -= 1;
      summary.failed += 1;
      result.status = 'failed';
      result.message = message;
    };

    let verdicts: { index: number; ok: boolean; message: string | null }[];
    try {
      verdicts = await this.hr!.provisionEmployees(pending.map((p) => p.payload));
    } catch (error) {
      for (const p of pending) fail(p.row, (error as Error).message);
      return;
    }
    const byIndex = new Map(verdicts.map((v) => [v.index, v]));
    for (const [index, p] of pending.entries()) {
      const verdict = byIndex.get(index);
      // A missing verdict is not a pass: hr-service answered about fewer rows than it was
      // asked about, and this row is one it never spoke for.
      if (!verdict) {
        fail(p.row, 'hr-service tidak melaporkan hasil untuk baris ini.');
      } else if (!verdict.ok) {
        fail(p.row, verdict.message ?? 'hr-service menolak baris ini.');
      }
    }
  }

  /**
   * Change an EXISTING account's staff role, by account id rather than by phone.
   *
   * Separate from `inviteStaff` on purpose: this one never creates anybody. It backs an
   * HR jabatan change, where the account is already known and the only question is what
   * it may now do — inviting by phone there would silently mint a second account if the
   * employee's phone had been corrected in the meantime.
   */
  async setStaffRole(customerId: string, role: Role, depotId?: string | null): Promise<PublicCustomer> {
    if (role === Role.CUSTOMER) {
      throw new InvalidStaffRoleError();
    }
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }
    const depot = depotId === undefined ? customer.assignedDepotId : depotId;
    if (isDepotLocked(role as unknown as PlatformRole) && (depot ?? '') === '') {
      throw new StaffDepotRequiredError();
    }
    // B-1: `assignRole`, not `promoteToStaff`. hr-service calls this whenever a role OR a
    // depot changes, and `promoteToStaff` lifts SUSPENDED to ACTIVE — so editing a resigned
    // employee's depot handed their login back, with HR still reading RESIGNED and nothing
    // anywhere recording that the account had been reopened.
    customer.assignRole(role, depot);
    return toPublicCustomer(await this.customers.save(customer));
  }

  /**
   * Move a staff account to another depot without touching their role or status.
   *
   * Until now the ONLY way to change an account's depot from the console was to re-invite
   * the same phone number, which happened to overwrite it — a transfer disguised as an
   * invitation. A depot-locked role still cannot end up with no depot.
   *
   * The move reaches the EMPLOYEE record too, exactly like `setStaffActive` below. Without
   * that push this method wrote one half of a transfer: the login moved and hr-service
   * kept rostering, geofencing and paying the same person at the depot they had left, with
   * nothing anywhere reporting that the two records disagreed. It is the only console
   * write to `assignedDepotId` that ever lacked one — invite and import carry the depot in
   * their provision call, and `setStaffRole` is reached only FROM hr-service.
   *
   * Pushed AFTER the local write, like `setStaffActive`, and hard: hr-service refuses a
   * move that would strand the employee in another depot's department, and that refusal
   * has to fail the whole transfer rather than leave the halves disagreeing.
   */
  async setStaffDepot(customerId: string, depotId: string | null): Promise<PublicCustomer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }
    if (customer.role === Role.CUSTOMER) {
      throw new InvalidStaffRoleError();
    }
    if (isDepotLocked(customer.role as unknown as PlatformRole) && (depotId ?? '') === '') {
      throw new StaffDepotRequiredError();
    }
    customer.assignDepot(depotId);
    const staff = toPublicCustomer(await this.customers.save(customer));
    // A franchise owner has no employee record to move — same skip as setStaffActive.
    if (this.hr && staff.role !== Role.FRANCHISE_OWNER) {
      await this.hr.setEmployeeDepot(staff.id, depotId);
    }
    return staff;
  }

  /**
   * Switch a staff login off (resignation, suspension) or back on, from the console — and
   * carry it through to their employee record.
   *
   * Split in two on purpose, and the same split exists in hr-service. This method writes
   * AND tells the other side; `setStaffActiveInternal` below only writes, and is what the
   * other side calls. Without the split each service would answer the other's notification
   * with a notification of its own, forever.
   */
  async setStaffActive(customerId: string, active: boolean): Promise<PublicCustomer> {
    const staff = await this.setStaffActiveInternal(customerId, active);
    if (this.hr && staff.role !== Role.FRANCHISE_OWNER) {
      await this.hr.setEmployeeActive(staff.id, active);
    }
    return staff;
  }

  /**
   * HR correcting an employee's name or phone number, reaching the login behind them.
   *
   * The third of the HR → auth pushes, next to role and status. Without it the staff
   * directory kept whatever name the invite was made with forever, and — worse — a
   * corrected phone number changed only the HR record while the OTP still went to the old
   * one, with nothing on either screen saying the two disagreed.
   *
   * Writes only, no push back: the HR side is the notifying half (see setStaffActive).
   *
   * A phone already belonging to somebody else is a CONFLICT, never a silent skip and
   * never a merge — the number is the login identity, and moving it onto an account that
   * exists would hand one person another's session. The repository re-checks on the write
   * itself, which closes the race this pre-check cannot.
   */
  async updateStaffProfileInternal(
    customerId: string,
    changes: { fullName?: string | null; phone?: string },
  ): Promise<PublicCustomer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }
    if (changes.phone !== undefined) {
      const phone = PhoneNumber.create(changes.phone).value;
      if (phone !== customer.phone) {
        const owner = await this.customers.findByPhone(phone);
        if (owner && owner.id !== customerId) {
          throw new PhoneAlreadyRegisteredError();
        }
        customer.changePhone(phone);
      }
    }
    if (changes.fullName !== undefined) {
      customer.updateProfile(changes.fullName, undefined);
    }
    return toPublicCustomer(await this.customers.save(customer));
  }

  /** The write half, with no outbound call. Used by the route hr-service calls. */
  async setStaffActiveInternal(customerId: string, active: boolean): Promise<PublicCustomer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }
    if (customer.role === Role.CUSTOMER) {
      throw new InvalidStaffRoleError();
    }
    customer.setActive(active);
    return toPublicCustomer(await this.customers.save(customer));
  }

  /**
   * Pre-register an end customer imported by depot staff (bulk import). Creates the
   * identity in PENDING_VERIFICATION so the customer still claims it themselves: the
   * normal `/auth/register` flow re-issues an OTP for a PENDING phone and activates
   * it on verify. Never touches an account that is already past PENDING — an active
   * customer's row is somebody else's, not the importer's to overwrite.
   */
  async preRegisterCustomer(
    rawPhone: string,
    fullName?: string | null,
  ): Promise<{ customerId: string; status: 'created' | 'pending' | 'active' }> {
    const phone = PhoneNumber.create(rawPhone).value;
    const existing = await this.customers.findByPhone(phone);
    if (existing) {
      return {
        customerId: existing.id,
        status: existing.status === CustomerStatus.PENDING_VERIFICATION ? 'pending' : 'active',
      };
    }
    const created = await this.customers.create({
      phone,
      email: null,
      fullName: fullName?.trim() || null,
      role: Role.CUSTOMER,
    });
    return { customerId: created.id, status: 'created' };
  }

  /**
   * Set the caller's avatar to a freshly uploaded image URL (FR-009). The upload
   * itself is handled by the storage port at the controller edge; this only
   * persists the resulting public URL onto the account.
   */
  async setAvatar(customerId: string, url: string): Promise<PublicCustomer> {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError();
    }
    customer.setAvatar(url);
    const saved = await this.customers.save(customer);
    return toPublicCustomer(saved);
  }

  async listSessions(customerId: string): Promise<SessionInfo[]> {
    return this.sessions.listActive(customerId);
  }

  /** Revoke one of the caller's own sessions by id; false if it isn't theirs/active. */
  async revokeSession(customerId: string, sessionId: string): Promise<boolean> {
    return this.sessions.revokeSession(customerId, sessionId);
  }

  async logoutAll(customerId: string, context: RequestContext): Promise<void> {
    await this.sessions.revokeAll(customerId);
    await this.audit.record({
      customerId,
      action: AuditAction.LOGOUT_ALL,
      success: true,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }
}
