import { Injectable } from '@nestjs/common';

import { RequestContext, SessionResult } from '../results';
import { AuditAction, AuditService } from './audit.service';
import { SessionService } from './session.service';

export interface RefreshCommand {
  refreshToken: string;
  context: RequestContext;
}

export interface LogoutCommand {
  refreshToken: string;
  actorCustomerId: string;
  context: RequestContext;
}

/** Token rotation and single-session logout (FR-005, FR-008). */
@Injectable()
export class TokenService {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async refresh(command: RefreshCommand): Promise<SessionResult> {
    const session = await this.sessions.refresh(command.refreshToken, command.context);

    await this.audit.record({
      customerId: session.customer.id,
      action: AuditAction.TOKEN_REFRESHED,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
    });

    return session;
  }

  async logout(command: LogoutCommand): Promise<void> {
    await this.sessions.revokeByToken(command.refreshToken);

    await this.audit.record({
      customerId: command.actorCustomerId,
      action: AuditAction.LOGOUT,
      success: true,
      ipAddress: command.context.ipAddress,
      userAgent: command.context.userAgent,
    });
  }
}
