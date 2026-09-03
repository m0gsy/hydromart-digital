import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { PdpRepository } from '../application/ports/pdp.repository';
import { CUSTOMER_TOKENS } from '../application/tokens';
import { CrmDashboard, DepotCrmService } from '../application/services/depot-crm.service';
import { CustomerImportService } from '../application/services/customer-import.service';
import { ResellerService, ScheduledSweepResult } from '../application/services/reseller.service';
import { CrmDashboardDto, CrmDepotDashboardDto } from './dto/depot-crm.dto';
import { ClaimFavoriteDepotDto, PdpCustomerDto, ResolveByPhoneDto } from './dto/pdp.dto';
import {
  ClaimFavoriteDepotResponseDto,
  CrmDashboardResponseDto,
  CustomerIdsByDepot2ResponseDto,
  InternalResellerPricingResponseDto,
  ResolveByPhoneResponseDto,
  ScheduledResellerSweepResponseDto,
} from './dto/responses.generated.dto';

/**
 * Service-to-service reads (no end-user token). @Public() bypasses the global JWT guard;
 * InternalAuthGuard (shared INTERNAL_SERVICE_KEY, x-internal-key) is then the sole, fail-closed auth.
 */
@ApiTags('Internal')
@Public()
@UseGuards(InternalAuthGuard)
@ApiSecurity('internal-key')
@Controller({ path: 'customers', version: '1' })
export class InternalController {
  constructor(
    private readonly crm: DepotCrmService,
    private readonly customers: CustomerImportService,
    private readonly resellers: ResellerService,
    @Inject(CUSTOMER_TOKENS.PdpRepository) private readonly pdp: PdpRepository,
  ) {}

  /**
   * §I: the counter buyer, resolved (or pre-registered) by phone. order-service calls this
   * when a walk-in sale carries a phone but no customerId — the resolution used to happen
   * in the POS page's browser, so every other client booked the sale against the anonymous
   * sentinel and created nobody.
   */
  @ApiOkResponse({ type: ResolveByPhoneResponseDto })
  @Post('internal/resolve-by-phone')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve or pre-register a customer by phone (internal service auth)' })
  resolveByPhone(
    @Body() dto: ResolveByPhoneDto,
  ): Promise<{ customerId: string; status: 'created' | 'pending' | 'active' }> {
    // C9: no name means NO name. This used to pass the phone number instead, so an account
    // was created whose `fullName` was "081234567890" — shown as a person's name on every
    // screen that lists customers, for somebody who never verified and never consented.
    return this.customers.resolveByPhone(dto.phone, dto.fullName ?? null, dto.depotId);
  }

  /**
   * UU PDP tahap 1 (item 13). auth-service owns the request queue and calls these two
   * after HEAD OFFICE approves — they are not reachable with a customer's own token,
   * because nothing here should run without that decision.
   */
  @Get('internal/pdp-export')
  @ApiOperation({ summary: 'Everything customer-service holds for a customer (internal)' })
  pdpExport(
    @Query('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<Record<string, unknown>> {
    return this.pdp.exportFor(customerId);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Post('internal/pdp-anonymise')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Strip profile and address PII for a deleted customer (internal, idempotent)',
  })
  pdpAnonymise(@Body() dto: PdpCustomerDto): Promise<void> {
    return this.pdp.anonymise(dto.customerId);
  }

  /**
   * §I: a customer who has never ordered belonged to no depot's directory, because
   * `favoriteDepotId` was written by the Excel importer and by a `PATCH /profile` the
   * console never calls. order-service reports the fulfilling depot at checkout, and this
   * records it — ONLY when there is none, so the last depot to sell somebody water can
   * never steal them from the depot they actually belong to.
   *
   * Fail-soft on the caller's side: the order is already placed either way.
   */
  @ApiOkResponse({ type: ClaimFavoriteDepotResponseDto })
  @Post('internal/favorite-depot')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a first-checkout depot as the favourite, if none is set' })
  async claimFavoriteDepot(@Body() dto: ClaimFavoriteDepotDto): Promise<{ claimed: boolean }> {
    return { claimed: await this.crm.claimFavoriteDepot(dto.customerId, dto.depotId) };
  }

  /**
   * A6/A9: agen pricing for a NAMED buyer, read service-to-service.
   *
   * order-service used to ask `/resellers/:id` with the CASHIER's bearer. `resellerView`
   * lists MANAGER and above but neither KEPALA_DEPOT nor STAFF_DEPOT — the only roles that
   * ever staff a till — so that read answered 403, the adapter's catch-all turned it into
   * "not a reseller", and the counter charged every agen retail. Measured: both roles 403,
   * MANAGER 404. Internal key instead, so the answer no longer depends on who is standing
   * at the counter.
   *
   * `homeDepotId` is part of the answer, not decoration: the caller decides whether this
   * agen may be priced at the depot doing the selling (A9). Without it nothing could ask,
   * and an agen registered at one depot drew their discount from someone else's franchise.
   *
   * 404 stays 404 — "not a reseller" is a real answer and must stay distinguishable from
   * "the read failed", which is what the adapter now keys its fail-closed decision on.
   */
  @ApiOkResponse({ type: InternalResellerPricingResponseDto })
  @Get('internal/reseller/:customerId')
  @ApiOperation({ summary: 'Agen pricing + home depot for one buyer (internal service auth)' })
  async resellerPricing(
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<{
    active: boolean;
    discountPct: number;
    flatGallonPriceIdr: number;
    homeDepotId: string;
  }> {
    const r = await this.resellers.pricingFor(customerId);
    return {
      active: r.active,
      discountPct: r.discountPct,
      flatGallonPriceIdr: r.flatGallonPriceIdr,
      homeDepotId: r.homeDepotId,
    };
  }

  /**
   * K4.2. Applies agen price changes that were scheduled for a date that has now arrived.
   * Driven by the scheduler — the whole point of a date is that nobody has to be present
   * for it. `ok` is false only when there was work and none of it landed (J7).
   */
  @ApiOkResponse({ type: ScheduledResellerSweepResponseDto })
  @Post('internal/resellers/apply-scheduled')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply due scheduled agen price changes (internal, scheduler)' })
  applyScheduledResellerChanges(): Promise<ScheduledSweepResult> {
    return this.resellers.applyScheduled();
  }

  @ApiOkResponse({ type: CustomerIdsByDepot2ResponseDto })
  @Get('internal/by-depot')
  @ApiOperation({ summary: 'List customerIds whose favourite depot is the given depot (internal)' })
  async customerIdsByDepot(
    @Query('depotId', ParseUUIDPipe) depotId: string,
  ): Promise<{ customerIds: string[] }> {
    return { customerIds: await this.crm.listCustomerIdsByDepot(depotId) };
  }

  // dashboard-service pulls per-depot CRM segments + follow-up count for the owner
  // franchise dashboard (Fase 5). Same CRM lifecycle math as the bearer-gated dashboard.
  @ApiOkResponse({ type: CrmDashboardResponseDto })
  @Get('internal/crm-summary')
  @ApiOperation({ summary: 'Per-depot CRM lifecycle summary (internal service auth)' })
  @ApiOkResponse({ type: CrmDashboardDto })
  crmSummary(@Query('depotId', ParseUUIDPipe) depotId: string): Promise<CrmDashboard> {
    return this.crm.getCrmDashboard(depotId);
  }

  // The batch of the route above: the owner dashboard asks for every depot it owns in one
  // request instead of one per depot (audit S-1). Each row echoes its depotId so the
  // caller can key the response without relying on ordering.
  @Get('internal/crm-summaries')
  @ApiOperation({ summary: 'Per-depot CRM lifecycle summary for MANY depots (internal)' })
  @ApiOkResponse({ type: CrmDepotDashboardDto, isArray: true })
  async crmSummaries(
    @Query('depotIds') depotIds: string,
  ): Promise<(CrmDashboard & { depotId: string })[]> {
    const ids = (depotIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    // ponytail: the per-depot CRM math still runs once per depot — what this removes is the
    // HTTP round-trip per depot, which is the expensive half. Concurrent, because each
    // depot's read is independent; pushing the lifecycle counts into one grouped query is
    // a separate change to depotCustomerStats.
    return Promise.all(
      ids.map(async (depotId) => ({ depotId, ...(await this.crm.getCrmDashboard(depotId)) })),
    );
  }
}
