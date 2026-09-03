import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can } from '@hydromart/platform';

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
