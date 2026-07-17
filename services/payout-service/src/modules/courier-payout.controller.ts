import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
  Roles,
} from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import {
  CourierEarningsSummary,
  CourierPayoutService,
} from '../application/services/courier-payout.service';
import { ExpenseClaimService } from '../application/services/expense-claim.service';
import { CourierLedgerEntryRecord } from '../application/ports/courier-ledger.repository';
import { CourierWithdrawalRecord } from '../application/ports/courier-withdrawal.repository';
import { ExpenseClaimRecord } from '../application/ports/expense-claim.repository';
import { Page } from '../application/pagination';
import {
  CashVarianceEventDto,
  CourierLedgerQueryDto,
  DeliveryCompletedEventDto,
} from './dto/courier-payout.dto';
import { ExpenseQueryDto, SubmitExpenseDto } from './dto/expense-claim.dto';
import { RequestWithdrawalDto } from './dto/payout.dto';

// Courier-scoped: reads the calling courier's own earnings ledger (user.sub).
@ApiTags('Courier Payout')
@ApiBearerAuth()
@Roles(...CAPABILITIES.courierPayout)
@Controller({ path: 'courier', version: '1' })
export class CourierPayoutController {
  constructor(
    private readonly payout: CourierPayoutService,
    private readonly expenses: ExpenseClaimService,
  ) {}

  @Get('earnings/summary')
  @ApiOperation({ summary: "Balance, this month's earnings + recent activity (design 2c)" })
  summary(@CurrentUser() user: AuthenticatedUser): Promise<CourierEarningsSummary> {
    return this.payout.summary(user.sub);
  }

  @Get('ledger')
  @ApiOperation({ summary: 'Paginated earnings cash-book for the calling courier' })
  ledger(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CourierLedgerQueryDto,
  ): Promise<Page<CourierLedgerEntryRecord>> {
    return this.payout.ledgerPage(user.sub, query.page, query.limit);
  }

  @Post('withdrawals')
  @ApiOperation({ summary: 'Cash out available balance to the bank (design 2c)' })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
  ): Promise<CourierWithdrawalRecord> {
    return this.payout.requestWithdrawal(user.sub, dto.amount, dto.bankAccountRef);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Withdrawal history for the calling courier (design 2c riwayat)' })
  withdrawals(@CurrentUser() user: AuthenticatedUser): Promise<CourierWithdrawalRecord[]> {
    return this.payout.withdrawalHistory(user.sub);
  }

  @Post('expenses')
  @ApiOperation({ summary: 'File an expense claim (design 6a); auto-approves under threshold' })
  submitExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitExpenseDto,
  ): Promise<ExpenseClaimRecord> {
    return this.expenses.submit(user.sub, {
      category: dto.category,
      amount: dto.amount,
      description: dto.description,
      depotId: dto.depotId ?? null,
      receiptUrl: dto.receiptUrl ?? null,
    });
  }

  @Get('expenses')
  @ApiOperation({ summary: 'Expense claims filed by the calling courier (design 6a)' })
  expenseHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExpenseQueryDto,
  ): Promise<Page<ExpenseClaimRecord>> {
    return this.expenses.listForCourier(user.sub, query.page, query.limit);
  }

  // System-triggered: delivery-service posts a completed delivery, authenticated by the
  // shared INTERNAL_SERVICE_KEY (no end-user token). @Public() skips the JWT guard;
  // InternalAuthGuard is the sole (fail-closed) auth. Idempotent by deliveryId.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('ledger/internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record courier earning for a completed delivery (internal service auth)' })
  async recordEarning(
    @Body() dto: DeliveryCompletedEventDto,
  ): Promise<{ recorded: boolean }> {
    const entry = await this.payout.recordDeliveryEarning({
      courierId: dto.courierId,
      depotId: dto.depotId ?? null,
      deliveryId: dto.deliveryId,
      deliveredAt: dto.deliveredAt,
      onTime: dto.onTime,
    });
    return { recorded: entry !== null };
  }

  // System-triggered: delivery-service posts a COD deposit shortfall charged at settlement
  // verify (design 2d). Same internal-key auth; idempotent by settlementId.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('ledger/variance/internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Debit a courier for a COD deposit shortfall (internal service auth)' })
  async recordVariance(@Body() dto: CashVarianceEventDto): Promise<{ recorded: boolean }> {
    const entry = await this.payout.recordCashVariance({
      courierId: dto.courierId,
      depotId: dto.depotId ?? null,
      settlementId: dto.settlementId,
      amount: dto.amount,
    });
    return { recorded: entry !== null };
  }
}
