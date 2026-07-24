import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CAPABILITIES } from '@hydromart/access';
import { Roles } from '@hydromart/platform';

import { AuditService } from '../application/services/audit.service';
import { ListAuditDto } from './dto/audit.dto';

/** HR audit-trail viewer. hrAdmin only — audit is HQ-wide and sensitive. */
@ApiTags('HR Audit')
@ApiBearerAuth()
@Controller({ path: 'hr-audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(...CAPABILITIES.hrAdmin)
  @ApiOperation({ summary: 'List HR audit-log entries' })
  async list(@Query() q: ListAuditDto) {
    const { rows, total } = await this.audit.list(q);
    return { rows, total, page: q.page, pageSize: q.pageSize };
  }
}
