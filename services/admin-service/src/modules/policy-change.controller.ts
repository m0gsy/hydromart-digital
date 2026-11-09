import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { PolicyChangeService } from '../application/services/policy-change.service';
import {
  DecidePolicyChangeDto,
  ListPolicyChangesQueryDto,
  PolicyChangeDto,
} from './dto/policy-change.dto';

// AAS-14 - the four-eyes queue for security-policy and retention-window changes. SUPER_ADMIN
// only, like the policies themselves; the service refuses the person who asked.
@ApiTags('Policy changes')
@ApiBearerAuth()
@Can('platformAdmin')
// Every decision reaches the audit trail (CA-2-67).
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'policy-changes', version: '1' })
export class PolicyChangeController {
  constructor(private readonly changes: PolicyChangeService) {}

  @ApiOkResponse({ type: PolicyChangeDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List policy change requests (newest first)' })
  async list(@Query() query: ListPolicyChangesQueryDto): Promise<PolicyChangeDto[]> {
    return (await this.changes.list(query.status)).map(PolicyChangeDto.from);
  }

  @ApiOkResponse({ type: PolicyChangeDto })
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve and apply a pending change (not the requester)' })
  async approve(
    @Param('id') id: string,
    @Body() dto: DecidePolicyChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PolicyChangeDto> {
    return PolicyChangeDto.from(await this.changes.approve(id, user.sub, dto.note ?? null));
  }

  @ApiOkResponse({ type: PolicyChangeDto })
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending change (not the requester)' })
  async reject(
    @Param('id') id: string,
    @Body() dto: DecidePolicyChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PolicyChangeDto> {
    return PolicyChangeDto.from(await this.changes.reject(id, user.sub, dto.note ?? null));
  }
}
