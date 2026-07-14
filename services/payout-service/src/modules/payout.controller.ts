import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { PayoutService, PayoutSummary } from '../application/services/payout.service';
import { LedgerEntryRecord, WithdrawalRecord } from '../domain/ledger';
import { Page } from '../application/pagination';
import { LedgerQueryDto, RequestWithdrawalDto } from './dto/payout.dto';

// Owner-scoped: every endpoint reads the caller's own franchise ledger (user.sub).
@ApiTags('Payout')
@ApiBearerAuth()
@Roles(...CAPABILITIES.payout)
@Controller({ path: 'payout', version: '1' })
export class PayoutController {
  constructor(private readonly payout: PayoutService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Balance, month revenue/commission, next payout + recent activity' })
  summary(@CurrentUser() user: AuthenticatedUser): Promise<PayoutSummary> {
    return this.payout.summary(user.sub);
  }

  @Get('ledger')
  @ApiOperation({ summary: 'Paginated cash-book entries for the calling owner' })
  ledger(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LedgerQueryDto,
  ): Promise<Page<LedgerEntryRecord>> {
    return this.payout.ledgerPage(user.sub, query.page, query.limit);
  }

  @Post('withdrawals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a withdrawal to the owner bank account' })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
  ): Promise<WithdrawalRecord> {
    return this.payout.requestWithdrawal(user.sub, dto.amount, dto.bankAccountRef);
  }
}
