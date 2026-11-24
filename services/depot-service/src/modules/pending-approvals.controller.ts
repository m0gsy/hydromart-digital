import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import {
  PendingApprovalsReader,
  PendingSummary,
} from '../application/ports/pending-approvals.reader';
import { DEPOT_TOKENS } from '../application/tokens';
import { PendingSummaryQueryDto } from './dto/pending-approvals.dto';

/**
 * HD-11: dashboard-service asks, for one person, how many items wait in the queues this service
 * holds. Internal key only; the gateway strips that key, so none of this is reachable from
 * outside. WHICH queues the person decides, and over which depots, the caller settles from their
 * token; what counts as waiting, and what a person never decides themselves, is answered here.
 */
@ApiTags('Pending approvals (internal)')
@Controller({ path: 'pending-approvals/internal', version: '1' })
export class PendingApprovalsController {
  constructor(
    @Inject(DEPOT_TOKENS.PendingApprovalsReader) private readonly reader: PendingApprovalsReader,
  ) {}

  @ApiOkResponse({ description: '{ count, oldestAt }: price changes a depot proposed, still PENDING' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('price-overrides')
  @ApiOperation({ summary: 'Price-override proposals waiting for head office (internal)' })
  priceOverrides(@Query() query: PendingSummaryQueryDto): Promise<PendingSummary> {
    return this.reader.priceOverrides(query.depotIds);
  }

  @ApiOkResponse({ description: '{ count, oldestAt }: applications not yet approved or rejected' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('franchise-applications')
  @ApiOperation({ summary: 'Franchise applications waiting for a decision (internal)' })
  franchiseApplications(@Query() _query: PendingSummaryQueryDto): Promise<PendingSummary> {
    // No depot and no applicant among the staff: the queue is the same for every reviewer.
    return this.reader.franchiseApplications();
  }

  @ApiOkResponse({ description: '{ count, oldestAt }: depot approval items PENDING or HELD' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('approvals')
  @ApiOperation({ summary: "Depot approval items waiting for this person's decision (internal)" })
  approvals(@Query() query: PendingSummaryQueryDto): Promise<PendingSummary> {
    return this.reader.approvals(query.depotIds, query.actorId);
  }
}
