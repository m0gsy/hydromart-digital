import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess } from '@hydromart/platform';

import { AnswerEnvelope } from '../application/ai-read/envelope';
import { assertSplittable } from '../application/ai-read/split';
import { VISIT_METRICS, VisitMetricsService } from '../application/ai-read/visit-metrics';
import { AnswerEnvelopeDto } from './dto/ai-read.dto';
import { VisitQueryDto } from './dto/ai-read-visit.dto';

/**
 * AI-21: supervisor visits as counts per depot (V-01..V-04). Same guards and envelope as the other read routes;
 * no visitor, finding text, photo or note is ever returned.
 */
@ApiTags('AI read')
@ApiBearerAuth()
@Controller({ path: 'ai/read', version: '1' })
export class AiReadVisitController {
  constructor(private readonly visits: VisitMetricsService) {}

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('visits')
  @ApiOperation({ summary: 'One supervisor-visit metric: visits made (V-01), days since the last visit (V-02), follow-ups (V-03), findings (V-04)' })
  visitMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: VisitQueryDto): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    assertSplittable(metric, period, VISIT_METRICS);
    return this.visits.answer(metric, user, period);
  }
}
