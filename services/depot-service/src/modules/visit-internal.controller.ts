import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { VisitService } from '../application/services/visit.service';
import { AiStockWindowQueryDto } from './dto/ai-stock.dto';
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

  /** AI-21: per-depot visit counts for the AI read API. The caller has already narrowed the depots to what the asker may read. */
  @ApiOkResponse({ description: '`{ items }`: one row per asked depot, counts and the WIB day of the last completed visit.' })
  @Get('ai-summary')
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @ApiOperation({ summary: 'Visit counts per depot for the AI read API, no visitor or finding text (internal service auth)' })
  async aiSummary(@Query() q: AiStockWindowQueryDto) {
    return { items: await this.visits.aiSummary(q.depotIds.split(','), new Date(q.from), new Date(q.to)) };
  }
}
