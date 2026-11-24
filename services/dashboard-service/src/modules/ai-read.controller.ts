import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess } from '@hydromart/platform';

import { AnswerEnvelope, ok } from '../application/ai-read/envelope';
import { parsePeriod } from '../application/ai-read/period';
import { ReadScopeService } from '../application/ai-read/scope.service';
import { AnswerEnvelopeDto, PeriodQueryDto } from './dto/ai-read.dto';

/**
 * HD-6: the AI web's read API (contracts/ai-v1/read.openapi.json). Every route answers the same
 * envelope, within the caller's own depots narrowed by the legal-entity matrix, in the WIB
 * calendar, with no phone, name or address. The person's own AI-web token; machine tokens are not
 * let in. H1 is the foundation: `scope` answers what the caller may read, and each metric group
 * adds its routes beside it.
 */
@ApiTags('AI read')
@ApiBearerAuth()
@Controller({ path: 'ai/read', version: '1' })
export class AiReadController {
  constructor(private readonly scopes: ReadScopeService) {}

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('scope')
  @ApiOperation({ summary: 'How many depots the caller may read for a period, and which legal entities they belong to' })
  async scope(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PeriodQueryDto,
  ): Promise<AnswerEnvelope<number>> {
    const asOf = new Date();
    const period = parsePeriod(query, asOf);
    const scope = await this.scopes.resolve(user, period);
    return ok(
      { metricId: 'meta.scope', period, scope: { depotIds: scope.depotIds, legalEntityIds: scope.legalEntityIds }, unit: 'depot', asOf },
      scope.depotIds.length,
    );
  }
}
