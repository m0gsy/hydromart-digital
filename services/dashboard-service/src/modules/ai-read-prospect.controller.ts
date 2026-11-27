import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess } from '@hydromart/platform';

import { AnswerEnvelope } from '../application/ai-read/envelope';
import { ProspectMetricsService } from '../application/ai-read/prospect-metrics';
import { AnswerEnvelopeDto } from './dto/ai-read.dto';
import { ProspectQueryDto } from './dto/ai-read-prospect.dto';

/**
 * AREA-3: where the B2B prospects are, how many were won and how many visits were made, per depot,
 * kecamatan, kelurahan or 1 km cell. Same guards and envelope as the other read routes; no business name,
 * phone, address or coordinate is ever returned, and a group of fewer than 3 is held back.
 */
@ApiTags('AI read')
@ApiBearerAuth()
@Controller({ path: 'ai/read', version: '1' })
export class AiReadProspectController {
  constructor(private readonly prospects: ProspectMetricsService) {}

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('prospects')
  @ApiOperation({ summary: 'B2B prospects (B-01, now), conversions (B-02) or visits (B-03) of one month, per depot, kecamatan, kelurahan or 1 km cell' })
  prospectMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: ProspectQueryDto): Promise<AnswerEnvelope> {
    return this.prospects.answer(query.metric, user, query);
  }
}
