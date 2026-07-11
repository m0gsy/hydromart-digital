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

import { ReferralService } from '../application/services/referral.service';
import {
  QualifyReferralDto,
  RedeemReferralDto,
  ReferralCodeDto,
  ReferralDto,
  ReferralPageQueryDto,
  ReferralSummaryDto,
} from './dto/referral.dto';

// Qualification is triggered when the referee's first order completes. It is a
// system-to-system call from order-service, authenticated by the shared
// INTERNAL_SERVICE_KEY, not a JWT.
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

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('qualify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Qualify a referee's referral on order completion (internal service auth, idempotent)" })
  qualify(@Body() dto: QualifyReferralDto) {
    // Reward is awarded via referral's own internal-key call to loyalty (no forwarded token).
    return this.referrals.qualify(dto.customerId, dto.orderId, '');
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
