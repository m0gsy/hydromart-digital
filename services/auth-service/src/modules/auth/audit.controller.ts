import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';

import { AuditService } from '../../application/services/audit.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { Role } from '../../domain/customer/role.enum';
import { AuditLogDto, AuditQueryDto, DepotAuditQueryDto, IngestAuditDto } from './dto/audit.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller({ version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // HQ audit trail (feature 8a): recent privileged actions across services, newest
  // first. Read is head-office / super-admin only.
  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Get('auth/audit')
  @ApiOperation({ summary: 'List recent audit entries (HQ, paginated, newest first)' })
  async list(@Query() query: AuditQueryDto): Promise<{
    items: AuditLogDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const result = await this.audit.list({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      action: query.action,
      customerId: query.actorId,
    });
    return { ...result, items: result.items.map(AuditLogDto.from) };
  }

  // Depot-scoped audit trail (design 8b): a depot operator/manager sees their own
  // depot's privileged actions. auditRead spans depot roles + HQ. depotId is required
  // by the DTO, so this route can never fan out to the whole network.
  @Roles(...CAPABILITIES.auditRead)
  @Get('auth/audit/depot')
  @ApiOperation({ summary: 'List a depot-scoped audit trail (newest first, category chips)' })
  async listForDepot(@Query() query: DepotAuditQueryDto): Promise<{
    items: AuditLogDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const result = await this.audit.list({
      page: query.page ?? 1,
      limit: query.limit ?? 50,
      depotId: query.depotId,
      type: query.type,
    });
    return { ...result, items: result.items.map(AuditLogDto.from) };
  }

  // Service-to-service ingest: another service records a privileged action it
  // performed. @Public() bypasses the JWT guard; InternalAuthGuard (shared key) is
  // then the sole, fail-closed auth.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('auth/audit/internal')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a cross-service audit event (internal service auth)' })
  async ingest(@Body() dto: IngestAuditDto): Promise<{ recorded: boolean }> {
    await this.audit.ingest({
      actorId: dto.actorId ?? null,
      action: dto.action,
      target: dto.target,
      success: dto.success,
      metadata: dto.metadata,
    });
    return { recorded: true };
  }
}
