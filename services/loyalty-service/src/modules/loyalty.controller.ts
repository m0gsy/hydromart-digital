import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  Can,
  CurrentUser,
  InternalAuthGuard,
  Public,
  Role,
  Roles,
} from '@hydromart/platform';

import { LoyaltyService } from '../application/services/loyalty.service';
import { Page } from '../application/pagination';
import {
  AdjustPointsDto,
  DepotSummaryQueryDto,
  EarnPointsDto,
  EarnResultDto,
  ListTransactionsQueryDto,
  LoyaltyAccountDto,
  LoyaltyRulesDto,
  PointsTransactionDto,
  ReverseEarnDto,
  RewardPointsDto,
  TierScopeQueryDto,
} from './dto/loyalty.dto';
import { TierBenefit } from '../domain/membership';
import { DepotLoyaltySummary, ExpiryResult } from '../application/services/loyalty.service';
import {
  DepotLoyaltyResponseDto,
  ExpiryResponseDto,
  ExpirySweepResponseDto,
  MemberCountResponseDto,
  PagedPointsTransactionResponseDto,
  TierBenefitResponseDto,
} from './dto/responses.generated.dto';

// earn + reward are system-to-system calls (order-service on completion, referral +
// customer-service birthday) authenticated by the shared INTERNAL_SERVICE_KEY, not a JWT.

@ApiTags('Loyalty')
@Controller({ path: 'loyalty', version: '1' })
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @ApiOkResponse({ type: TierBenefitResponseDto, isArray: true })
  @Public()
  @Get('tiers')
  @ApiOperation({ summary: 'List membership tiers and their benefits (FR-014)' })
  tiers(@Query() query: TierScopeQueryDto): TierBenefit[] {
    return this.loyalty.getTiers(query.depotId ?? null);
  }

  /*
   * Public, like `tiers` above and for the same reason: the rewards card and the help FAQ
   * quote these two numbers to people who are not signed in, and the settings schema that
   * holds them is `@Can('depotAdmin')`. Read-only, and nothing here is per-customer.
   */
  @ApiOkResponse({ type: LoyaltyRulesDto })
  @Public()
  @Get('rules')
  @ApiOperation({ summary: 'The earning rules a screen may state (BR-013/014)' })
  rules(@Query() query: TierScopeQueryDto): LoyaltyRulesDto {
    return this.loyalty.getRules(query.depotId ?? null);
  }

  @ApiOkResponse({ type: LoyaltyAccountDto })
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: "Get the current customer's loyalty account (FR-014/015)" })
  async me(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TierScopeQueryDto,
  ): Promise<LoyaltyAccountDto> {
    const { account, tier, discountRate } = await this.loyalty.getStanding(
      user.sub,
      query.depotId ?? null,
    );
    return LoyaltyAccountDto.from(account, tier, discountRate);
  }

  // Counter sale: staff ring up the purchase, so the buyer's tier cannot come from the
  // token — that token belongs to the cashier, and /me would quote the cashier's own
  // discount. Internal-key only, never a customer-reachable route.
  @ApiOkResponse({ type: LoyaltyAccountDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('accounts/:customerId')
  @ApiOperation({ summary: "Read a named customer's standing (internal service auth)" })
  async standingFor(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: TierScopeQueryDto,
  ): Promise<LoyaltyAccountDto> {
    const { account, tier, discountRate } = await this.loyalty.getStanding(
      customerId,
      query.depotId ?? null,
    );
    return LoyaltyAccountDto.from(account, tier, discountRate);
  }

  @ApiOkResponse({ type: PagedPointsTransactionResponseDto })
  @ApiBearerAuth()
  @Get('me/transactions')
  @ApiOperation({ summary: "List the current customer's points ledger" })
  async myTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<Page<PointsTransactionDto>> {
    const page = await this.loyalty.listTransactions(user.sub, query.page, query.limit);
    return { ...page, items: page.items.map((t) => PointsTransactionDto.from(t)) };
  }

  @ApiOkResponse({ type: EarnResultDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('earn')
  @ApiOperation({
    summary: 'Award points for a completed order (internal service auth, BR-013, idempotent)',
  })
  async earn(@Body() dto: EarnPointsDto): Promise<EarnResultDto> {
    const result = await this.loyalty.earnForOrder(
      dto.customerId,
      dto.orderId,
      dto.subtotal,
      dto.depotId ?? null,
    );
    return { ...LoyaltyAccountDto.from(result.account), pointsEarned: result.pointsEarned };
  }

  @ApiOkResponse({ type: LoyaltyAccountDto })
  @ApiBearerAuth()
  @Can('loyaltyAdjust')
  @Post('adjust')
  @ApiOperation({ summary: 'Apply a signed manual points correction (staff)' })
  async adjust(@Body() dto: AdjustPointsDto): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(
      await this.loyalty.adjust(dto.customerId, dto.points, dto.reason),
    );
  }

  @ApiOkResponse({ type: LoyaltyAccountDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('reward')
  @ApiOperation({
    summary: 'Grant a flat positive reward (internal service auth, e.g. referral/birthday bonus)',
  })
  async reward(@Body() dto: RewardPointsDto): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(
      await this.loyalty.reward(dto.customerId, dto.points, dto.reason),
    );
  }

  // Voiding a counter sale has to take back the points it awarded, and the cashier who
  // voids it is not a MANAGER — the staff `adjust` route above is out of their reach on
  // purpose. Scoped by order, never by an amount the caller names: this service owns the
  // per-depot earn rate, so only it knows what that sale really earned.
  @ApiOkResponse({ type: LoyaltyAccountDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/reverse-earn')
  @ApiOperation({ summary: "Take back a reversed order's points (internal service auth)" })
  async reverseEarn(@Body() dto: ReverseEarnDto): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(
      await this.loyalty.reverseEarnForOrder(dto.customerId, dto.orderId, dto.reason),
    );
  }

  @ApiOkResponse({ type: ExpiryResponseDto })
  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN)
  @Post('expire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sweep expired point lots (system/scheduler, BR-014)' })
  expire(): Promise<ExpiryResult> {
    return this.loyalty.runExpiry();
  }

  /**
   * PAR-01. The same sweep, reachable by the scheduler.
   *
   * `POST loyalty/expire` above is SUPER_ADMIN-only, i.e. it needs a human's JWT — and
   * scripts/scheduler/sweep.sh authenticates with `x-internal-key` and has no JWT to
   * offer. So BR-014 was built, guarded, tested, and callable by nobody on a schedule:
   * points have never expired in production, and the liability has been accruing since
   * launch. This is the door the scheduler can actually open.
   *
   * `ok` is the J7 verdict sweep.sh greps for: a 200 says the transport worked, not that
   * the round did. False only when the sweep could not do its job. Deliberately switched
   * off is NOT a failure — pinning the scheduler to unhealthy because an operator chose
   * not to expire points would report an outage that is not one.
   */
  @ApiOkResponse({ type: ExpirySweepResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/expire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sweep expired point lots (scheduler, internal service auth, BR-014)' })
  async expireInternal(): Promise<ExpiryResult & { ok: boolean }> {
    return { ...(await this.loyalty.runExpiry()), ok: true };
  }

  @ApiOkResponse({ type: MemberCountResponseDto })
  @ApiBearerAuth()
  @Can('loyaltyRead')
  @Get('members/count')
  @ApiOperation({ summary: 'HQ broadcast reach: total enrolled loyalty members' })
  async memberCount(): Promise<{ count: number }> {
    return { count: await this.loyalty.countMembers() };
  }

  @ApiOkResponse({ type: DepotLoyaltyResponseDto })
  @ApiBearerAuth()
  @Can('loyaltyRead')
  @Get('depot-summary')
  @ApiOperation({
    summary: 'Depot-scoped loyalty rollup: members, tiers, points outstanding, redeemed this month',
  })
  depotSummary(@Query() query: DepotSummaryQueryDto): Promise<DepotLoyaltySummary> {
    return this.loyalty.depotSummary(query.depotId);
  }

  @ApiOkResponse({ type: LoyaltyAccountDto })
  @ApiBearerAuth()
  @Can('loyaltyRead')
  @Get('customers/:customerId')
  @ApiOperation({ summary: "Read a customer's loyalty account (staff)" })
  async byCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(await this.loyalty.getAccount(customerId));
  }
}
