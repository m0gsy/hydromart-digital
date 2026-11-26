import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { VisitService } from '../application/services/visit.service';
import { OverdueSweepResponseDto } from './dto/visit.dto';

/** Service-to-service (the scheduler): internal key only, no person behind it. */
@ApiTags('Visits')
@Controller({ path: 'visits/internal', version: '1' })
export class VisitInternalController {
  constructor(private readonly visits: VisitService) {}

  /**
   * Counts the open follow-ups past their WIB deadline and, when VISIT_NOTIFY_ENABLED, reminds each
   * depot's Kepala, supervisors and HQ (every 3 days while a follow-up stays overdue).
   */
  @ApiOkResponse({ type: OverdueSweepResponseDto })
  @Post('overdue-sweep')
  @HttpCode(200)
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @ApiOperation({ summary: 'Count and remind overdue visit follow-ups (internal service auth)' })
  overdueSweep(): Promise<{ depots: number; items: number; notified: number }> {
    return this.visits.overdueSweep();
  }
}
