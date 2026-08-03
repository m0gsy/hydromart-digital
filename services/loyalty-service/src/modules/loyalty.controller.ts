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
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { LoyaltyService } from '../application/services/loyalty.service';
import { Page } from '../application/pagination';
import {
  AdjustPointsDto,
  DepotSummaryQueryDto,
  EarnPointsDto,
  EarnResultDto,
  ListTransactionsQueryDto,
  LoyaltyAccountDto,
  PointsTransactionDto,
  ReverseEarnDto,
  RewardPointsDto,
  TierScopeQueryDto,
} from './dto/loyalty.dto';

// earn + reward are system-to-system calls (order-service on completion, referral +
// customer-service birthday) authenticated by the shared INTERNAL_SERVICE_KEY, not a JWT.
const ADJUST_ROLES = [Role.MANAGER, Role.MARKETING, Role.SUPER_ADMIN] as const;
const READ_ROLES = [
  Role.MANAGER,
  Role.HEAD_OFFICE,
  Role.MARKETING,
  Role.SUPER_ADMIN,
] as const;

@ApiTags('Loyalty')
@Controller({ path: 'loyalty', version: '1' })
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Public()
  @Get('tiers')
  @ApiOperation({ summary: 'List membership tiers and their benefits (FR-014)' })
  tiers(@Query() query: TierScopeQueryDto) {
    return this.loyalty.getTiers(query.depotId ?? null);
  }

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

  @ApiBearerAuth()
  @Roles(...ADJUST_ROLES)
  @Post('adjust')
  @ApiOperation({ summary: 'Apply a signed manual points correction (staff)' })
  async adjust(@Body() dto: AdjustPointsDto): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(
      await this.loyalty.adjust(dto.customerId, dto.points, dto.reason),
    );
  }

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

  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN)
  @Post('expire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sweep expired point lots (system/scheduler, BR-014)' })
  expire() {
    return this.loyalty.runExpiry();
  }

  @ApiBearerAuth()
  @Roles(...READ_ROLES)
  @Get('members/count')
  @ApiOperation({ summary: 'HQ broadcast reach: total enrolled loyalty members' })
  async memberCount(): Promise<{ count: number }> {
    return { count: await this.loyalty.countMembers() };
  }

  @ApiBearerAuth()
  @Roles(...READ_ROLES)
  @Get('depot-summary')
  @ApiOperation({
    summary: 'Depot-scoped loyalty rollup: members, tiers, points outstanding, redeemed this month',
  })
  depotSummary(@Query() query: DepotSummaryQueryDto) {
    return this.loyalty.depotSummary(query.depotId);
  }

  @ApiBearerAuth()
  @Roles(...READ_ROLES)
  @Get('customers/:customerId')
  @ApiOperation({ summary: "Read a customer's loyalty account (staff)" })
  async byCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(await this.loyalty.getAccount(customerId));
  }
}
