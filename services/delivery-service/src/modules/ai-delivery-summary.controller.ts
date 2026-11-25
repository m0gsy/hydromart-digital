import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { AiDeliverySummary, AiDeliverySummaryService } from '../application/services/ai-delivery-summary.service';
import { AiSpansDto } from './dto/ai-delivery.dto';

/**
 * HD-6 H3: delivered, on-time, failed and rescheduled counts for the AI read API (dashboard-service).
 * Internal key only; the caller has already narrowed what the asker may read to spans (a depot and
 * the instants it was readable). Counts only: no courier, customer, address or free-text reason.
 */
@ApiTags('Reports')
@Controller({ path: 'reports/internal', version: '1' })
export class AiDeliverySummaryController {
  constructor(private readonly summaries: AiDeliverySummaryService) {}

  @ApiOkResponse({ description: 'delivered, onTime, storedVerdicts, thresholdMinutes, medianMinutes, couriers, failed, noShow, otherFailed, rescheduled, byReason (failed by fixed reason code).' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('ai-summary')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delivered, on-time, failed and rescheduled deliveries over spans (internal service auth)' })
  summary(@Body() body: AiSpansDto): Promise<AiDeliverySummary> {
    return this.summaries.summary(body.spans.map((s) => ({ depotId: s.depotId, from: new Date(s.from), to: new Date(s.to) })));
  }
}
