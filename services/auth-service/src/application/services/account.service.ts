import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';

import {
  CustomerNotFoundError,
  EmailAlreadyRegisteredError,
  InvalidStaffRoleError,
  StaffDepotRequiredError,
} from '../../domain/errors/auth.errors';
// The locked-role set is the guards' own definition, imported rather than mirrored: the
// two Role enums carry identical string values, so the cast is a type bridge, not a
// second source of truth.
import { ImportSummary, isDepotLocked, Role as PlatformRole, runImport } from '@hydromart/platform';

import { Role } from '../../domain/customer/role.enum';
import { CustomerStatus } from '../../domain/customer/customer-status.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { CustomerRepository } from '../ports/customer.repository';
import { HR_DIRECTORY_PORT, HrDirectoryPort } from '../ports/hr-directory.port';
import { AUTH_TOKENS } from '../tokens';
import { PublicCustomer, RequestContext, toPublicCustomer } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { SessionInfo, SessionService } from './session.service';

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
  ): Promise<{ items: PublicCustomer[]; total: number; page: number; limit: number }> {
    const { items, total } = await this.customers.listStaff(page, limit, role, depotId);
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
    const PAGE = 200;
    const drivers: PublicCustomer[] = [];
    for (let page = 1; ; page += 1) {
      const { items, total } = await this.customers.listStaff(page, PAGE, Role.STAFF_DEPOT, depotId);
      drivers.push(...items.map(toPublicCustomer));
      if (items.length === 0 || drivers.length >= total) break;
    }
    return drivers.filter((c) => c.status === CustomerStatus.ACTIVE);
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
  ): Promise<PublicCustomer> {
    if (role === Role.CUSTOMER) {
      throw new InvalidStaffRoleError();
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
      return toPublicCustomer(await this.customers.save(existing));
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
    return toPublicCustomer(await this.customers.save(created));
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
  async inviteStaffWithEmployee(input: InviteStaffInput): Promise<PublicCustomer> {
    const staff = await this.inviteStaff(input.phone, input.role, input.fullName, input.depotId, {
      vehicleType: input.vehicleType,
      plateNumber: input.plateNumber,
    });
    if (input.role === Role.FRANCHISE_OWNER) {
      return staff;
    }
    if (!this.hr) {
      throw new ServiceUnavailableException(
        'hr-service belum dikonfigurasi; undangan staf tidak bisa diproses.',
      );
    }
    await this.hr.provisionEmployee({
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
    });
    return staff;
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
  async importStaff(rows: readonly ImportStaffRow[]): Promise<ImportSummary> {
    return runImport(rows, async (row) => {
      // Looked up BEFORE the write, and with the same normalisation inviteStaff uses —
      // asking afterwards would call every row `updated`.
      const existing = await this.customers.findByPhone(PhoneNumber.create(row.phone).value);
      const staff = await this.inviteStaffWithEmployee(row);
      return { status: existing ? 'updated' : 'created', id: staff.id };
    });
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
    customer.promoteToStaff(role, depot);
    return toPublicCustomer(await this.customers.save(customer));
  }

  /**
   * Move a staff account to another depot without touching their role or status.
   *
   * Until now the ONLY way to change an account's depot from the console was to re-invite
   * the same phone number, which happened to overwrite it — a transfer disguised as an
   * invitation. A depot-locked role still cannot end up with no depot.
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
    return toPublicCustomer(await this.customers.save(customer));
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
