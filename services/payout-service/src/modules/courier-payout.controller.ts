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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, InternalAuthGuard, Public } from '@hydromart/platform';

import {
  CourierEarningsSummary,
  CourierPayoutService,
} from '../application/services/courier-payout.service';
import { ExpenseClaimService } from '../application/services/expense-claim.service';
import {
  CourierEarningRuleRecord,
  CourierEarningsRow,
  CourierLedgerEntryRecord,
} from '../application/ports/courier-ledger.repository';
import { CourierWithdrawalRecord } from '../application/ports/courier-withdrawal.repository';
import { ExpenseClaimRecord } from '../application/ports/expense-claim.repository';
import { Page } from '../application/pagination';
import {
  CashVarianceEventDto,
  CourierLedgerQueryDto,
  DeliveryCompletedEventDto,
  DepotEarningsQueryDto,
} from './dto/courier-payout.dto';
import { ExpenseQueryDto, SubmitExpenseDto } from './dto/expense-claim.dto';
import { RequestWithdrawalDto } from './dto/payout.dto';
import { CourierEarningRuleResponseDto, CourierEarningsResponseDto, CourierWithdrawalResponseDto, ExpenseClaimResponseDto, PagedCourierLedgerEntryResponseDto, PagedExpenseClaimResponseDto, RecordEarning2ResponseDto, DepotEarningsResponseDto } from './dto/responses.generated.dto';

// Courier-scoped: reads the calling courier's own earnings ledger (user.sub).
@ApiTags('Courier Payout')
@ApiBearerAuth()
@Can('courierPayout')
@Controller({ path: 'courier', version: '1' })
export class CourierPayoutController {
  constructor(
    private readonly payout: CourierPayoutService,
    private readonly expenses: ExpenseClaimService,
  ) {}

  @ApiOkResponse({ type: CourierEarningsResponseDto })
  @Get('earnings/summary')
  @ApiOperation({ summary: "Balance, this month's earnings + recent activity (design 2c)" })
  summary(@CurrentUser() user: AuthenticatedUser): Promise<CourierEarningsSummary> {
    // The depot comes off the token, exactly as `earningRule` below takes it: the ladder
    // shown and the deliveries counted against it must belong to the same depot, and a
    // client-supplied one could not be held to that.
    return this.payout.summary(user.sub, user.depotId ?? null);
  }

  @ApiOkResponse({ type: CourierEarningRuleResponseDto })
  @Get('earning-rule')
  @ApiOperation({
    summary: "Effective earning rule for the courier's depot — monthly target + incentive tiers",
  })
  earningRule(@CurrentUser() user: AuthenticatedUser): Promise<CourierEarningRuleRecord | null> {
    return this.payout.effectiveRule(user.depotId ?? null);
  }

  @ApiOkResponse({ type: PagedCourierLedgerEntryResponseDto })
  @Get('ledger')
  @ApiOperation({ summary: 'Paginated earnings cash-book for the calling courier' })
  ledger(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CourierLedgerQueryDto,
  ): Promise<Page<CourierLedgerEntryRecord>> {
    return this.payout.ledgerPage(user.sub, query.page, query.limit);
  }

  @ApiOkResponse({ type: CourierWithdrawalResponseDto })
  @Post('withdrawals')
  @ApiOperation({ summary: 'Cash out available balance to the bank (design 2c)' })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
  ): Promise<CourierWithdrawalRecord> {
    return this.payout.requestWithdrawal(user.sub, dto.amount, dto.bankAccountRef);
  }

  @ApiOkResponse({ type: CourierWithdrawalResponseDto, isArray: true })
  @Get('withdrawals')
  @ApiOperation({ summary: 'Withdrawal history for the calling courier (design 2c riwayat)' })
  withdrawals(@CurrentUser() user: AuthenticatedUser): Promise<CourierWithdrawalRecord[]> {
    return this.payout.withdrawalHistory(user.sub);
  }

  @ApiOkResponse({ type: ExpenseClaimResponseDto })
  @Post('expenses')
  @ApiOperation({ summary: 'File an expense claim (design 6a); auto-approves under threshold' })
  submitExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitExpenseDto,
  ): Promise<ExpenseClaimRecord> {
    // AUTHZ-B3: the caller rides along so the service can refuse a depot that is not
    // theirs — the body used to decide both the books and the auto-approve threshold.
    return this.expenses.submit(
      user.sub,
      {
        category: dto.category,
        amount: dto.amount,
        description: dto.description,
        depotId: dto.depotId ?? null,
        receiptUrl: dto.receiptUrl ?? null,
      },
      user,
    );
  }

  @ApiOkResponse({ type: PagedExpenseClaimResponseDto })
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
  @ApiOkResponse({ type: RecordEarning2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('ledger/internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record courier earning for a completed delivery (internal service auth)',
  })
  async recordEarning(@Body() dto: DeliveryCompletedEventDto): Promise<{ recorded: boolean }> {
    const entry = await this.payout.recordDeliveryEarning({
      courierId: dto.courierId,
      depotId: dto.depotId ?? null,
      deliveryId: dto.deliveryId,
      deliveredAt: dto.deliveredAt,
      onTime: dto.onTime,
    });
    return { recorded: entry !== null };
  }

  /*
   * E-1: what each courier at a depot was actually PAID over a window, read by
   * delivery-service's commission report.
   *
   * That report used to answer from its own flat `courierRatePerDeliveryIdr` — a rate
   * configured in a service that pays nobody — so a manager's commission run and the
   * courier's own ledger disagreed about the same work, permanently and invisibly. The
   * money has one home; this is how the report reads it instead of guessing at it.
   *
   * Internal-key: the caller is a service, and the same figures are already readable by
   * the courier through their own ledger routes.
   */
  @ApiOkResponse({ type: DepotEarningsResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('ledger/internal/depot-earnings')
  @ApiOperation({ summary: "Paid courier earnings for a depot's window (internal service auth)" })
  async depotEarnings(
    @Query() query: DepotEarningsQueryDto,
  ): Promise<{ couriers: CourierEarningsRow[] }> {
    return {
      couriers: await this.payout.earningsByDepot(
        query.depotId,
        new Date(query.from),
        new Date(query.to),
      ),
    };
  }

  // System-triggered: delivery-service posts a COD deposit shortfall charged at settlement
  // verify (design 2d). Same internal-key auth; idempotent by settlementId.
  @ApiOkResponse({ type: RecordEarning2ResponseDto })
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
