import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, InternalAuthGuard, Public } from '@hydromart/platform';

import { AuditService } from '../application/services/audit.service';
import { ListAuditDto } from './dto/audit.dto';
import { RetentionReportDto } from './dto/employee.dto';

/** HR audit-trail viewer. hrAdmin only — audit is HQ-wide and sensitive. */
@ApiTags('HR Audit')
@ApiBearerAuth()
@Controller({ path: 'hr-audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Can('hrAdmin')
  @ApiOperation({ summary: 'List HR audit-log entries' })
  async list(@Query() q: ListAuditDto) {
    const { rows, total } = await this.audit.list(q);
    return { rows, total, page: q.page, pageSize: q.pageSize };
  }

  /**
   * HR-2: the retention sweep admin-service drives, same internal-key shape as the employee
   * retention routes. The window lives in the retention console, not here.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/retention')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete HR audit rows older than the cutoff (internal)' })
  purge(@Body() dto: RetentionReportDto): Promise<{ purged: number }> {
    return this.audit.purgeOlderThan(new Date(dto.cutoff));
  }
}
