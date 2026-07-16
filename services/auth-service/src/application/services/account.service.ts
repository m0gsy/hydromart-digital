import { Inject, Injectable } from '@nestjs/common';

import {
  CustomerNotFoundError,
  EmailAlreadyRegisteredError,
  InvalidStaffRoleError,
} from '../../domain/errors/auth.errors';
import { Role } from '../../domain/customer/role.enum';
import { CustomerStatus } from '../../domain/customer/customer-status.enum';
import { PhoneNumber } from '../../domain/value-objects/phone-number';
import { CustomerRepository } from '../ports/customer.repository';
import { AUTH_TOKENS } from '../tokens';
import { PublicCustomer, RequestContext, toPublicCustomer } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { SessionInfo, SessionService } from './session.service';

/** Account self-service: profile, active sessions, and logout-everywhere (FR-009/010). */
@Injectable()
export class AccountService {
  constructor(
    @Inject(AUTH_TOKENS.CustomerRepository) private readonly customers: CustomerRepository,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
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
  ): Promise<{ items: PublicCustomer[]; total: number; page: number; limit: number }> {
    const { items, total } = await this.customers.listStaff(page, limit, role);
    return { items: items.map(toPublicCustomer), total, page, limit };
  }

  /**
   * Driver roster for dispatch (feature 9b): active couriers only, so staff can
   * pick one by name. Reuses the staff-directory query with a DRIVER filter and
   * keeps only ACTIVE accounts. Non-paginated — a depot has few drivers.
   * ponytail: single generous page; add real pagination if a depot ever runs 500+ drivers.
   */
  async listDrivers(): Promise<PublicCustomer[]> {
    const { items } = await this.customers.listStaff(1, 500, Role.DRIVER);
    return items.map(toPublicCustomer).filter((c) => c.status === CustomerStatus.ACTIVE);
  }

  /**
   * Invite a staff member by phone (PRD Module 7). Promotes an existing account to
   * the given staff role, or creates a new pre-activated account if the phone is
   * unknown (they sign in by phone OTP). The role must not be CUSTOMER.
   */
  async inviteStaff(rawPhone: string, role: Role, fullName?: string | null): Promise<PublicCustomer> {
    if (role === Role.CUSTOMER) {
      throw new InvalidStaffRoleError();
    }
    const phone = PhoneNumber.create(rawPhone).value;
    const existing = await this.customers.findByPhone(phone);
    if (existing) {
      existing.promoteToStaff(role);
      if (fullName !== undefined && fullName !== null && fullName !== '') {
        existing.updateProfile(fullName, undefined);
      }
      return toPublicCustomer(await this.customers.save(existing));
    }
    const created = await this.customers.create({
      phone,
      email: null,
      fullName: fullName ?? null,
      role,
    });
    // create() defaults the account to PENDING; activate it so the invitee can sign in.
    created.promoteToStaff(role);
    return toPublicCustomer(await this.customers.save(created));
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
