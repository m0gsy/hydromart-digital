import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { PayoutService, PendingPayout } from '../application/services/payout.service';
import { WithdrawalRecord } from '../domain/ledger';
import { ReleasePayoutDto } from './dto/payout.dto';

/**
 * HQ payout-release queue (design 6a, right panel). Cross-owner, HQ-only: FINANCE +
 * SUPER_ADMIN — gated directly on the roles (this network view is not part of the
 * owner-scoped `payout` capability, which stays FRANCHISE_OWNER-only).
 */
@ApiTags('Payout (HQ)')
@ApiBearerAuth()
@Roles(Role.FINANCE, Role.SUPER_ADMIN)
@Controller({ path: 'payout/hq', version: '1' })
export class HqPayoutController {
  constructor(private readonly payout: PayoutService) {}

  @Get('pending')
  @ApiOperation({ summary: 'Owners across the network with a positive balance awaiting release' })
  pending(): Promise<PendingPayout[]> {
    return this.payout.pendingPayouts();
  }

  // Read-only single-owner balance for the HQ depot-detail payout card. HEAD_OFFICE also
  // reads it (depot admins view depot detail); release stays FINANCE/SUPER_ADMIN only.
  @Roles(Role.HEAD_OFFICE, Role.FINANCE, Role.SUPER_ADMIN)
  @Get('owner/:ownerId')
  @ApiOperation({ summary: "One franchise owner's available balance + next release date" })
  ownerBalance(@Param('ownerId', ParseUUIDPipe) ownerId: string): Promise<PendingPayout> {
    return this.payout.availableForOwner(ownerId);
  }

  @Post('release')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Release an owner's full available balance to their bank" })
  release(@Body() dto: ReleasePayoutDto): Promise<WithdrawalRecord> {
    return this.payout.releaseForOwner(dto.franchiseOwnerId);
  }
}
