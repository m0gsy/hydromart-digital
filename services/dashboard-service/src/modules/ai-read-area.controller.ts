import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess } from '@hydromart/platform';

import { AreaMetricsService } from '../application/ai-read/area-metrics';
import { AnswerEnvelope } from '../application/ai-read/envelope';
import { AnswerEnvelopeDto } from './dto/ai-read.dto';
import { AreaQueryDto } from './dto/ai-read-area.dto';

/**
 * HD-20c: served and unserved demand per kecamatan, kelurahan or 1 km cell. Same guards and envelope as
 * the other read routes; no customer, address or coordinate is ever returned, and a cell of fewer than
 * 3 people is held back.
 */
@ApiTags('AI read')
@ApiBearerAuth()
@Controller({ path: 'ai/read', version: '1' })
export class AiReadAreaController {
  constructor(private readonly areas: AreaMetricsService) {}

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('areas')
  @ApiOperation({ summary: 'Served (A-01) or unserved (A-02) demand per kecamatan, kelurahan or 1 km cell for a whole closed month' })
  areaMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: AreaQueryDto): Promise<AnswerEnvelope> {
    return this.areas.answer(query.metric, user, query);
  }
}
