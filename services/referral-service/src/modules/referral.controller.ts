import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { ReferralService } from '../application/services/referral.service';
import {
  QualifyReferralDto,
  RedeemReferralDto,
  ReferralCodeDto,
  ReferralDto,
  ReferralPageQueryDto,
  ReferralSummaryDto,
} from './dto/referral.dto';

// Qualification is triggered when the referee's first order completes. order-service
// forwards the completing staff member's token, so it is limited to fulfilment roles
// (matches loyalty EARN roles).
const QUALIFY_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.DRIVER,
  Role.SUPER_ADMIN,
] as const;

const READ_ROLES = [
  Role.DEPOT_MANAGER,
  Role.HEAD_OFFICE,
  Role.MARKETING,
  Role.SUPER_ADMIN,
] as const;

@ApiTags('Referrals')
@Controller({ path: 'referrals', version: '1' })
export class ReferralController {
  constructor(private readonly referrals: ReferralService) {}

  // Static `me/...` routes are declared before any `:param` route to avoid capture.

  @ApiBearerAuth()
  @Get('me/code')
  @ApiOperation({ summary: "Get the current customer's referral code (FR-092, lazy-created)" })
  async myCode(@CurrentUser() user: AuthenticatedUser): Promise<ReferralCodeDto> {
    return ReferralCodeDto.from(await this.referrals.getOrCreateMyCode(user.sub));
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: "Get the current customer's referral summary (code + referrals)" })
  async mySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReferralPageQueryDto,
  ): Promise<ReferralSummaryDto> {
    return ReferralSummaryDto.from(
      await this.referrals.getMySummary(user.sub, query.page, query.limit),
    );
  }

  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Redeem a referral code as a new customer (FR-092)' })
  async redeem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemReferralDto,
  ): Promise<ReferralDto> {
    return ReferralDto.from(await this.referrals.redeem(user.sub, dto.code));
  }

  @ApiBearerAuth()
  @Roles(...QUALIFY_ROLES)
  @Post('qualify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Qualify a referee's referral on order completion (staff/system, idempotent)" })
  qualify(
    @Body() dto: QualifyReferralDto,
    @Headers('authorization') authorization: string,
  ) {
    // Forward the caller's token so loyalty rewards are awarded as the acting staff.
    return this.referrals.qualify(dto.customerId, dto.orderId, authorization);
  }

  @ApiBearerAuth()
  @Roles(...READ_ROLES)
  @Get('customers/:customerId')
  @ApiOperation({ summary: "Read a customer's referral summary (staff)" })
  async byCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: ReferralPageQueryDto,
  ): Promise<ReferralSummaryDto> {
    return ReferralSummaryDto.from(
      await this.referrals.getCustomerSummary(customerId, query.page, query.limit),
    );
  }
}
