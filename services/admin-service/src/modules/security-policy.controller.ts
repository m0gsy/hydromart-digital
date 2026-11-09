import { Body, Controller, Get, HttpCode, HttpStatus, Put, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuditMutationsInterceptor,
  AuthenticatedUser,
  Can,
  CurrentUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { PolicyChangeService } from '../application/services/policy-change.service';
import { SecurityPolicyService } from '../application/services/security-policy.service';
import { PolicyChangeRequestedDto } from './dto/policy-change.dto';
import { SaveSecurityPolicyDto, SecurityPolicyDto } from './dto/security-policy.dto';

// Design 19b — platform security policy (singleton). SUPER_ADMIN only, read and write.
// NOTE: active-session listing/enforcement lives in auth-service, not here — this endpoint
// only stores the policy (idle timeout, 2FA requirement, IP allowlist).
@ApiTags('Security policy')
@ApiBearerAuth()
@Can('platformAdmin')
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'security-policy', version: '1' })
export class SecurityPolicyController {
  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly changes: PolicyChangeService,
  ) {}

  /**
   * CA-2-06: the half auth-service reads, on the internal key.
   *
   * The console route above is `platformAdmin` and carries a user token; auth-service has
   * neither on the refresh path. Only the idle limit is returned — the allowlist and the
   * 2FA flag are not auth-service's business, and a policy endpoint that hands out an IP
   * allowlist to every service that asks is a map of where the admins are.
   */
  @ApiOkResponse({ description: 'The idle-session limit, in minutes.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal')
  @ApiOperation({ summary: 'Idle-session limit for auth-service (internal service auth)' })
  async idleLimit(): Promise<{ idleTimeoutMinutes: number }> {
    const { idleTimeoutMinutes } = await this.policy.get();
    return { idleTimeoutMinutes };
  }

  @ApiOkResponse({ type: SecurityPolicyDto })
  @Get()
  @ApiOperation({ summary: 'Read the security policy (idle timeout, 2FA, IP allowlist)' })
  async get(): Promise<SecurityPolicyDto> {
    return SecurityPolicyDto.from(await this.policy.get());
  }

  /**
   * AAS-14: this no longer applies the change - it REQUESTS it. A second super admin approves it
   * under POST policy-changes/:id/approve, which applies it through the same validated save.
   * The values are validated here, so an illegal one is refused to the person typing it.
   */
  @ApiOkResponse({ type: PolicyChangeRequestedDto })
  @Put()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a security-policy change (needs a second super admin)' })
  async save(
    @Body() dto: SaveSecurityPolicyDto,
    @Req() req: { auditBefore?: unknown },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PolicyChangeRequestedDto> {
    // AAS-09: a singleton has no old row to find later, so the audit entry carries it.
    const { idleTimeoutMinutes, require2fa, ipAllowlist } = await this.policy.get();
    req.auditBefore = { idleTimeoutMinutes, require2fa, ipAllowlist };
    const request = await this.changes.requestSecurityChange(
      {
        idleTimeoutMinutes: dto.idleTimeoutMinutes,
        require2fa: dto.require2fa,
        ipAllowlist: dto.ipAllowlist,
      },
      user.sub,
    );
    return { pending: true, requestId: request.id };
  }
}
