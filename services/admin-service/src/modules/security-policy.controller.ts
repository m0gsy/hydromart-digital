import { Body, Controller, Get, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can, InternalAuthGuard, Public } from '@hydromart/platform';

import { SecurityPolicyService } from '../application/services/security-policy.service';
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
  constructor(private readonly policy: SecurityPolicyService) {}

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

  @ApiOkResponse({ type: SecurityPolicyDto })
  @Put()
  @ApiOperation({ summary: 'Replace the security policy' })
  async save(@Body() dto: SaveSecurityPolicyDto): Promise<SecurityPolicyDto> {
    return SecurityPolicyDto.from(await this.policy.save(dto));
  }
}
