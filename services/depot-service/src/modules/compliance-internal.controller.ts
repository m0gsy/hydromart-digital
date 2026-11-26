import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { QualityHoldService } from '../application/services/quality-hold.service';
import { DueCompliance } from '../domain/quality-hold';

/** Service-to-service: the permits and lab tests due or overdue across the network (internal key only). */
@ApiTags('Quality hold')
@Controller({ path: 'internal/compliance', version: '1' })
export class ComplianceInternalController {
  constructor(private readonly holds: QualityHoldService) {}

  @ApiOkResponse({ description: '`{ items: DueCompliance[] }`: permits within 30 days of expiry or expired, lab tests past their interval; closed depots left out.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('due')
  @ApiOperation({ summary: 'Permits and lab tests due (internal service auth)' })
  async due(): Promise<{ items: DueCompliance[] }> {
    return { items: await this.holds.due() };
  }
}
