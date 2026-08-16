import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { PayoutService, PendingPayout } from '../application/services/payout.service';
import { WithdrawalRecord } from '../domain/ledger';
import { ReleasePayoutDto } from './dto/payout.dto';
import { PendingPayoutResponseDto, WithdrawalResponseDto } from './dto/responses.generated.dto';

/**
 * HQ payout-release queue (design 6a, right panel). Cross-owner, HQ-only: FINANCE +
 * SUPER_ADMIN — gated directly on the roles (this network view is not part of the
 * owner-scoped `payout` capability, which stays FRANCHISE_OWNER-only).
 */
@ApiTags('Payout (HQ)')
@ApiBearerAuth()
@Can('hqPayout')
@Controller({ path: 'payout/hq', version: '1' })
export class HqPayoutController {
  constructor(private readonly payout: PayoutService) {}

  // Same read as `owner/:ownerId` below, for the whole network instead of one owner — so it
  // carries the same capability. Inheriting the class-level `hqPayout` (FINANCE) meant
  // HEAD_OFFICE, whose own console shows this queue on /hq/payments and /hq/franchise, got
  // a 403 on the LIST while being explicitly allowed the per-owner form of the same figures.
  // Releasing money stays FINANCE/SUPER_ADMIN, which is what `hqPayout` is actually for.
  @ApiOkResponse({ type: PendingPayoutResponseDto, isArray: true })
  @Can('hqPayoutRead')
  @Get('pending')
  @ApiOperation({ summary: 'Owners across the network with a positive balance awaiting release' })
  pending(): Promise<PendingPayout[]> {
    return this.payout.pendingPayouts();
  }

  // Read-only single-owner balance for the HQ depot-detail payout card. HEAD_OFFICE also
  // reads it (depot admins view depot detail); release stays FINANCE/SUPER_ADMIN only.
  @ApiOkResponse({ type: PendingPayoutResponseDto })
  @Can('hqPayoutRead')
  @Get('owner/:ownerId')
  @ApiOperation({ summary: "One franchise owner's available balance + next release date" })
  ownerBalance(@Param('ownerId', ParseUUIDPipe) ownerId: string): Promise<PendingPayout> {
    return this.payout.availableForOwner(ownerId);
  }

  @ApiOkResponse({ type: WithdrawalResponseDto })
  @Post('release')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Release an owner's full available balance to their bank" })
  release(@Body() dto: ReleasePayoutDto): Promise<WithdrawalRecord> {
    return this.payout.releaseForOwner(dto.franchiseOwnerId);
  }
}
