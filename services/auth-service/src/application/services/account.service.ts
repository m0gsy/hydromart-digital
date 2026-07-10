import { Inject, Injectable } from '@nestjs/common';

import { CustomerNotFoundError } from '../../domain/errors/auth.errors';
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
