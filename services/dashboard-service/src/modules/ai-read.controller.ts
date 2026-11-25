import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess } from '@hydromart/platform';

import { AnswerEnvelope, belumAda, ok } from '../application/ai-read/envelope';
import { FranchiseMetricsService } from '../application/ai-read/franchise-metrics';
import { HrMetricsService } from '../application/ai-read/hr-metrics';
import { MoneyMetricsService } from '../application/ai-read/money-metrics';
import { parsePeriod } from '../application/ai-read/period';
import { ReadScopeService } from '../application/ai-read/scope.service';
import { AnswerEnvelopeDto, FranchiseQueryDto, HrQueryDto, MoneyQueryDto, PeriodQueryDto } from './dto/ai-read.dto';

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
  constructor(
    private readonly scopes: ReadScopeService,
    private readonly money: MoneyMetricsService,
    private readonly franchise: FranchiseMetricsService,
    private readonly hr: HrMetricsService,
  ) {}

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
    const base = { metricId: 'meta.scope', period, scope: scope.echo, unit: 'depot', asOf };
    // No depot is "nothing to read", not a count of 0 depots: it must not be quoted as a number.
    if (scope.echo.depotIds.length === 0) {
      return belumAda(base, 'Tidak ada depot yang boleh Anda baca pada periode ini.');
    }
    return ok(base, scope.echo.depotIds.length);
  }

  /**
   * HD-6 H2: the money metrics (sales P-, cash U-, profit and loss L-). One route, the metric id in
   * the `metric` query; the answer is the same envelope as `scope`, so a new metric changes only its id,
   * value and unit. An id outside the dictionary is a 404.
   */
  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('money')
  @ApiOperation({ summary: 'One money metric (sales, cash and COD, profit and loss) for a period' })
  moneyMetric(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MoneyQueryDto,
  ): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    return this.money.answer(metric, user, period);
  }

  /** HD-6 H5: franchise applications, depots by type, partner commission and legal entities (W-). Same envelope. */
  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('franchise')
  @ApiOperation({ summary: 'One franchise or legal-entity metric (calon mitra, depot types, commission) for a period' })
  franchiseMetric(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: FranchiseQueryDto,
  ): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    return this.franchise.answer(metric, user, period);
  }

  /** HD-6 H5: headcount, attendance, payroll, kasbon and bonus (H-). Same envelope. */
  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('hr')
  @ApiOperation({ summary: 'One HR metric (headcount, attendance, payroll, kasbon) for a period' })
  hrMetric(@CurrentUser() user: AuthenticatedUser, @Query() query: HrQueryDto): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    return this.hr.answer(metric, user, period);
  }
}
