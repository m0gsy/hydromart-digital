import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { AiQueuesService } from '../application/services/ai-queues.service';
import { OpenQueueRow } from '../application/ports/ai-queues.repository';
import { AiStockDepotsQueryDto } from './dto/ai-stock.dto';

/** HD-6 H4 part 2: A-01 for the AI read API (dashboard-service, internal key). Counts only, no row content. */
@ApiTags('AI read sources')
@Controller({ path: 'internal/ai-queues', version: '1' })
export class AiQueuesController {
  constructor(private readonly queues: AiQueuesService) {}

  @ApiOkResponse({ description: '`{ items: OpenQueueRow[] }`: one row per depot asked, zeros included.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('open')
  @ApiOperation({ summary: 'Open incidents, disputes, approvals and overdue maintenance per depot (internal service auth)' })
  async open(@Query() q: AiStockDepotsQueryDto): Promise<{ items: OpenQueueRow[] }> {
    return { items: await this.queues.open(q.depotIds.split(',')) };
  }
}
