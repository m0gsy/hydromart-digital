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

import { AuthenticatedUser, Can, CurrentUser } from '@hydromart/platform';

import { CourierPayoutService } from '../application/services/courier-payout.service';
import { CourierWithdrawalRecord } from '../application/ports/courier-withdrawal.repository';
import { PayoutService, PendingPayout } from '../application/services/payout.service';
import { WithdrawalRecord } from '../domain/ledger';
import { ReleasePayoutDto, SettleWithdrawalDto } from './dto/payout.dto';
import {
  CourierWithdrawalResponseDto,
  PendingPayoutResponseDto,
  WithdrawalResponseDto,
} from './dto/responses.generated.dto';

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
  constructor(
    private readonly payout: PayoutService,
    private readonly courierPayout: CourierPayoutService,
  ) {}

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

  /*
   * The way out of PROCESSING — six routes that did not exist.
   *
   * `WithdrawalStatus` has had PAID and FAILED since the first migration, and no code in
   * this service ever wrote either. So `release` above, and every courier tapping "Tarik
   * saldo", created a row that could never leave PROCESSING while its debit had already
   * left the balance. Finance had a queue with no way to answer it, and a rejected transfer
   * kept the money it never delivered.
   *
   * Reading the queue is `hqPayoutRead` (head office watches it); answering it stays
   * `hqPayout` — FINANCE and SUPER_ADMIN — the same split `pending` above already makes,
   * because settling is what moves money.
   */
  @ApiOkResponse({ type: WithdrawalResponseDto, isArray: true })
  @Can('hqPayoutRead')
  @Get('withdrawals/processing')
  @ApiOperation({ summary: 'Franchise withdrawals awaiting a bank result, oldest first' })
  processingWithdrawals(): Promise<WithdrawalRecord[]> {
    return this.payout.listProcessingWithdrawals();
  }

  @ApiOkResponse({ type: CourierWithdrawalResponseDto, isArray: true })
  @Can('hqPayoutRead')
  @Get('courier-withdrawals/processing')
  @ApiOperation({ summary: 'Courier withdrawals awaiting a bank result, oldest first' })
  processingCourierWithdrawals(): Promise<CourierWithdrawalRecord[]> {
    return this.courierPayout.listProcessingWithdrawals();
  }

  @ApiOkResponse({ type: WithdrawalResponseDto })
  @Post('withdrawals/:id/paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The bank transfer cleared: PROCESSING → PAID' })
  markWithdrawalPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WithdrawalRecord> {
    return this.payout.settleWithdrawal(id, 'PAID', user.sub);
  }

  @ApiOkResponse({ type: WithdrawalResponseDto })
  @Post('withdrawals/:id/failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The bank rejected the transfer: PROCESSING → FAILED, and the balance comes back',
  })
  markWithdrawalFailed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleWithdrawalDto,
  ): Promise<WithdrawalRecord> {
    return this.payout.settleWithdrawal(id, 'FAILED', user.sub, dto.reason);
  }

  @ApiOkResponse({ type: CourierWithdrawalResponseDto })
  @Post('courier-withdrawals/:id/paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "The courier's transfer cleared: PROCESSING → PAID" })
  markCourierWithdrawalPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CourierWithdrawalRecord> {
    return this.courierPayout.settleWithdrawal(id, 'PAID', user.sub);
  }

  @ApiOkResponse({ type: CourierWithdrawalResponseDto })
  @Post('courier-withdrawals/:id/failed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "The bank rejected the courier's transfer: FAILED, and the balance comes back",
  })
  markCourierWithdrawalFailed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleWithdrawalDto,
  ): Promise<CourierWithdrawalRecord> {
    return this.courierPayout.settleWithdrawal(id, 'FAILED', user.sub, dto.reason);
  }
}
