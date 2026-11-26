import { Controller, ForbiddenException, Get, Inject, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, ExternalAccess, MachineCan } from '@hydromart/platform';

import { AnswerEnvelope, belumAda, ok } from '../application/ai-read/envelope';
import { assertNoPersonalData } from '../application/ai-read/masking';
import { FRANCHISE_METRICS, FranchiseMetricsService } from '../application/ai-read/franchise-metrics';
import { HR_METRICS, HrMetricsService } from '../application/ai-read/hr-metrics';
import { AI_AGENT_MONEY_METRICS, MONEY_METRICS, MoneyMetricsService } from '../application/ai-read/money-metrics';
import { parsePeriod } from '../application/ai-read/period';
import { ReadScopeService } from '../application/ai-read/scope.service';
import { assertSplittable } from '../application/ai-read/split';
import { DashboardSourcesPort } from '../application/ports/dashboard-sources.port';
import { DASHBOARD_TOKENS } from '../application/tokens';
import { AnswerEnvelopeDto, FranchiseQueryDto, HrQueryDto, MoneyQueryDto, PeriodQueryDto } from './dto/ai-read.dto';
import { MachineReadAuditInterceptor } from './machine-read-audit.interceptor';

/** One depot of the scope. A null code or label = depot-service could not name it; never guessed. */
export interface ScopeDepot {
  depotId: string;
  code: string | null;
  label: string | null;
}

/**
 * HD-6: the AI web's read API (contracts/ai-v1/read.openapi.json). Every route answers the same
 * envelope, within the caller's own depots narrowed by the legal-entity matrix, in the WIB
 * calendar, with no phone, name or address. The person's own AI-web token; machine tokens are not
 * let in, but on `money` (AI-31: the AI web's own account, four metrics, the whole network). H1 is the foundation: `scope` answers what the caller may read, and each metric group
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
    @Inject(DASHBOARD_TOKENS.Sources) private readonly depots: DashboardSourcesPort,
  ) {}

  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai')
  @Can('aiRead')
  @Get('scope')
  @ApiOperation({ summary: 'How many depots the caller may read for a period, and which legal entities they belong to' })
  async scope(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PeriodQueryDto,
  ): Promise<AnswerEnvelope<number> & { depots?: ScopeDepot[] }> {
    assertSplittable('meta.scope', query, { 'meta.scope': true });
    const asOf = new Date();
    const period = parsePeriod(query, asOf);
    const scope = await this.scopes.resolve(user, period);
    const base = { metricId: 'meta.scope', period, scope: scope.echo, unit: 'depot', asOf };
    // No depot is "nothing to read", not a count of 0 depots: it must not be quoted as a number.
    if (scope.echo.depotIds.length === 0) {
      return belumAda(base, 'Tidak ada depot yang boleh Anda baca pada periode ini.');
    }
    const answer = ok(base, scope.echo.depotIds.length);
    // AI-7a: the depots' codes and display names (business data, not personal), so the AI web can name a depot it ranks.
    // A network-wide role already had the list read for its scope: no second call.
    const names = new Map((scope.network ?? (await this.depots.allDepots('')) ?? []).map((d) => [d.id, d]));
    const depots = scope.echo.depotIds.map((depotId): ScopeDepot => {
      const entry = { depotId, code: names.get(depotId)?.code ?? null, label: names.get(depotId)?.name ?? null };
      try {
        assertNoPersonalData(entry);
        return entry;
      } catch {
        // assertNoPersonalData throws only PersonalDataError: one depot whose name reads as personal data loses its name, not the whole answer.
        return { depotId, code: null, label: null };
      }
    });
    return { ...answer, depots };
  }

  /**
   * HD-6 H2: the money metrics (sales P-, cash U-, profit and loss L-). One route, the metric id in
   * the `metric` query; the answer is the same envelope as `scope`, so a new metric changes only its id,
   * value and unit. An id outside the dictionary is a 404.
   *
   * AI-31: also the one route the AI web's own machine account may read (a token holding
   * aiReadAgent): the whole network, only the metrics the agents need, every read audited first.
   */
  @ApiOkResponse({ type: AnswerEnvelopeDto })
  @ExternalAccess('ai', 'machine')
  @Can('aiRead')
  @MachineCan('aiReadAgent')
  @UseInterceptors(MachineReadAuditInterceptor)
  @Get('money')
  @ApiOperation({ summary: 'One money metric (sales, cash and COD, profit and loss) for a period' })
  moneyMetric(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MoneyQueryDto,
  ): Promise<AnswerEnvelope> {
    const { metric, ...period } = query;
    if (user.via === 'machine' && !AI_AGENT_MONEY_METRICS.has(metric)) {
      throw new ForbiddenException('Akun mesin ini hanya boleh membaca metrik yang disediakan untuk agen AI.');
    }
    assertSplittable(metric, period, MONEY_METRICS);
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
    assertSplittable(metric, period, FRANCHISE_METRICS);
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
    assertSplittable(metric, period, HR_METRICS);
    return this.hr.answer(metric, user, period);
  }
}
