import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Public, Role, Roles } from '@hydromart/platform';

import { LoyaltyService } from '../application/services/loyalty.service';
import { Page } from '../application/pagination';
import {
  AdjustPointsDto,
  EarnPointsDto,
  ListTransactionsQueryDto,
  LoyaltyAccountDto,
  PointsTransactionDto,
} from './dto/loyalty.dto';

// Points are awarded when an order completes (BR-013). order-service forwards the
// completing staff member's token, so earning is limited to the fulfilment roles.
const EARN_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.DRIVER,
  Role.SUPER_ADMIN,
] as const;

const ADJUST_ROLES = [Role.DEPOT_MANAGER, Role.MARKETING, Role.SUPER_ADMIN] as const;
const READ_ROLES = [
  Role.DEPOT_MANAGER,
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
  tiers() {
    return this.loyalty.getTiers();
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: "Get the current customer's loyalty account (FR-014/015)" })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(await this.loyalty.getAccount(user.sub));
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

  @ApiBearerAuth()
  @Roles(...EARN_ROLES)
  @Post('earn')
  @ApiOperation({ summary: 'Award points for a completed order (staff/system, BR-013, idempotent)' })
  async earn(@Body() dto: EarnPointsDto): Promise<LoyaltyAccountDto> {
    const result = await this.loyalty.earnForOrder(dto.customerId, dto.orderId, dto.subtotal);
    return LoyaltyAccountDto.from(result.account);
  }

  @ApiBearerAuth()
  @Roles(...ADJUST_ROLES)
  @Post('adjust')
  @ApiOperation({ summary: 'Apply a signed manual points correction (staff)' })
  async adjust(@Body() dto: AdjustPointsDto): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(await this.loyalty.adjust(dto.customerId, dto.points, dto.reason));
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
  @Get('customers/:customerId')
  @ApiOperation({ summary: "Read a customer's loyalty account (staff)" })
  async byCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<LoyaltyAccountDto> {
    return LoyaltyAccountDto.from(await this.loyalty.getAccount(customerId));
  }
}
