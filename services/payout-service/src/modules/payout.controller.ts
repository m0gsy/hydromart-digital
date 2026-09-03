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

import {
  Can,
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import {
  OrderRevenueResult,
  PayoutService,
  PayoutSummary,
} from '../application/services/payout.service';
import { LedgerEntryRecord, WithdrawalRecord } from '../domain/ledger';
import { Page } from '../application/pagination';
import {
  LedgerQueryDto,
  OrderRevenueDto,
  RequestWithdrawalDto,
  VoidOrderRevenueDto,
} from './dto/payout.dto';
import {
  OrderRevenueResponseDto,
  PagedLedgerEntryResponseDto,
  PayoutResponseDto,
  VoidRevenue2ResponseDto,
  WithdrawalResponseDto,
} from './dto/responses.generated.dto';

// Owner-scoped: every endpoint reads the caller's own franchise ledger (user.sub).
@ApiTags('Payout')
@ApiBearerAuth()
@Can('payout')
@Controller({ path: 'payout', version: '1' })
export class PayoutController {
  constructor(private readonly payout: PayoutService) {}

  @ApiOkResponse({ type: PayoutResponseDto })
  @Get('summary')
  @ApiOperation({ summary: 'Balance, month revenue/commission, next payout + recent activity' })
  summary(@CurrentUser() user: AuthenticatedUser): Promise<PayoutSummary> {
    return this.payout.summary(user.sub);
  }

  @ApiOkResponse({ type: PagedLedgerEntryResponseDto })
  @Get('ledger')
  @ApiOperation({ summary: 'Paginated cash-book entries for the calling owner' })
  ledger(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LedgerQueryDto,
  ): Promise<Page<LedgerEntryRecord>> {
    return this.payout.ledgerPage(user.sub, query.page, query.limit);
  }

  @ApiOkResponse({ type: WithdrawalResponseDto })
  @Post('withdrawals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a withdrawal to the owner bank account' })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
  ): Promise<WithdrawalRecord> {
    return this.payout.requestWithdrawal(user.sub, dto.amount, dto.bankAccountRef);
  }

  // System-triggered: order-service posts an order the moment it completes, authenticated
  // by the shared INTERNAL_SERVICE_KEY (no end-user token). @Public() skips the JWT guard;
  // InternalAuthGuard is the sole (fail-closed) auth. Idempotent by orderId.
  @ApiOkResponse({ type: OrderRevenueResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('revenue/internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a completed order as franchise revenue (internal service auth)',
  })
  recordRevenue(@Body() dto: OrderRevenueDto): Promise<OrderRevenueResult> {
    return this.payout.recordOrderRevenue({
      orderId: dto.orderId,
      franchiseOwnerId: dto.franchiseOwnerId,
      depotId: dto.depotId ?? null,
      amountIdr: dto.amountIdr,
      commissionBaseIdr: dto.commissionBaseIdr,
      orderNumber: dto.orderNumber ?? null,
      occurredAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
    });
  }

  // The other half: a counter sale reversed at the till has to give the revenue and the
  // commission back, or the owner is paid for money that was handed to the buyer.
  @ApiOkResponse({ type: VoidRevenue2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('revenue/internal/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Back out a voided order's revenue + commission (internal service auth)",
  })
  voidRevenue(@Body() dto: VoidOrderRevenueDto): Promise<{ reversed: boolean }> {
    return this.payout.reverseOrderRevenue(dto.orderId, dto.reason);
  }
}
