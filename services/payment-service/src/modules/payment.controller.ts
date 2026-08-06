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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  Can,
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { PaymentService, RefundQueueRow } from '../application/services/payment.service';
import {
  CashCollectedSummary,
  PaymentRecord,
  UnsettledMethodAggregate,
} from '../application/ports/payment.repository';
import { Page } from '../application/pagination';
import {
  CashCollectedQueryDto,
  ConfirmPaymentDto,
  DepotCashQueryDto,
  VoidForOrderDto,
  InitiatePaymentDto,
  ListPaymentsQueryDto,
  PaymentWebhookDto,
  RefundPaymentDto,
  StaffInitiatePaymentDto,
  UnsettledByMethodQueryDto,
} from './dto/payment.dto';
import {
  CashCollectedResponseDto,
  PagedPaymentResponseDto,
  PagedRefundQueueResponseDto,
  PaymentResponseDto,
  UnsettledMethodAggregateResponseDto,
  Webhook3ResponseDto,
} from './dto/responses.generated.dto';

// Refunds, the refund-approval queue (feature 14a) and the HQ settlement dashboard
// (design 6a) used to carry hand-written role arrays here, invisible to the shared map
// and untunable by a super admin. They are now three capabilities — refundIssue stays
// deliberately wider than refundQueue so whoever raises a refund is not whoever signs
// it off.

@ApiTags('Payments')
@ApiBearerAuth()
@Controller({ path: 'payments', version: '1' })
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @ApiOkResponse({ type: PaymentResponseDto })
  @Post()
  @ApiOperation({ summary: 'Initiate a payment for an order' })
  initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitiatePaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.initiate(user.sub, dto);
  }

  // Counter sale: the cashier records the payment for the buyer, so customerId comes from
  // the body rather than the token. A sibling route, not a branch inside the customer one —
  // the amount is still validated against the authoritative order total in the service.
  @ApiOkResponse({ type: PaymentResponseDto })
  @Post('staff')
  @Can('paymentSettle')
  @ApiOperation({ summary: 'Initiate a payment on behalf of a customer (counter sale)' })
  initiateForCustomer(@Body() dto: StaffInitiatePaymentDto): Promise<PaymentRecord> {
    return this.payments.initiate(dto.customerId, { ...dto, atCounter: true });
  }

  // Voiding a counter sale gives the buyer their money back. Internal-key only, and
  // deliberately not behind `refundIssue`: the cashier doing the void is not a manager, and
  // making them fetch one would leave the buyer waiting at the till with no refund.
  @ApiOkResponse({ type: PaymentResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/void-for-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reverse a voided counter sale's payment (internal service auth)" })
  voidForOrder(@Body() dto: VoidForOrderDto): Promise<PaymentRecord | null> {
    return this.payments.voidForOrder(dto.orderId, dto.reason, 'order-service');
  }

  // Shift close asks this: how much cash should be in THIS depot's drawer right now.
  // Internal-key only — depot-service is the caller, and the answer decides whether a
  // cashier is short. Declared before ':id' so the static segment wins.
  @ApiOkResponse({ type: CashCollectedResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/depot-cash')
  @ApiOperation({ summary: "Sum a depot's PAID cash over a window (internal service auth)" })
  depotCash(@Query() query: DepotCashQueryDto): Promise<CashCollectedSummary> {
    return this.payments.depotCashCollected(query.depotId, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @ApiOkResponse({ type: PagedPaymentResponseDto })
  @Get()
  @ApiOperation({ summary: "List the current customer's payments" })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPaymentsQueryDto,
  ): Promise<Page<PaymentRecord>> {
    return this.payments.listForCustomer(user.sub, query);
  }

  // Staff: read an order's payments to confirm receipt. Declared before ':id' so the
  // static 'for-order' segment wins. Not customer-scoped (staff act across customers).
  @ApiOkResponse({ type: PagedPaymentResponseDto })
  @Get('for-order/:orderId')
  @Can('paymentSettle')
  @ApiOperation({ summary: "List an order's payments (staff, for settlement)" })
  listForOrder(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<Page<PaymentRecord>> {
    return this.payments.listAll({ orderId, limit: 20 });
  }

  // HQ settlement dashboard (design 6a): network-wide unsettled payments grouped by
  // method. Declared before ':id' so the static segment wins. Read-only aggregate.
  @ApiOkResponse({ type: UnsettledMethodAggregateResponseDto, isArray: true })
  @Get('unsettled-by-method')
  @Can('settlementRead')
  @ApiOperation({ summary: 'Network unsettled payments grouped by method (finance/super-admin)' })
  unsettledByMethod(
    @Query() query: UnsettledByMethodQueryDto,
  ): Promise<UnsettledMethodAggregate[]> {
    return this.payments.unsettledByMethod({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  // HQ report export (design 10a): network-wide collected (PAID) revenue grouped by
  // method. Declared before ':id' so the static segment wins. Read-only aggregate.
  @ApiOkResponse({ type: UnsettledMethodAggregateResponseDto, isArray: true })
  @Get('revenue-by-method')
  @Can('settlementRead')
  @ApiOperation({ summary: 'Network collected revenue grouped by method (finance/super-admin)' })
  revenueByMethod(@Query() query: UnsettledByMethodQueryDto): Promise<UnsettledMethodAggregate[]> {
    return this.payments.revenueByMethod({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  // Courier COD deposit (design 2d/slice 9): sum of PAID cash over the courier's
  // delivered orders — the "how much" for an end-of-shift settlement. Bearer is
  // forwarded from delivery-service; settlement roles (incl. STAFF_DEPOT) may read.
  // Declared before ':id' so the static segment wins.
  @ApiOkResponse({ type: CashCollectedResponseDto })
  @Get('cash-collected')
  @Can('paymentSettle')
  @ApiOperation({ summary: 'Sum PAID cash over a set of orders (courier COD deposit)' })
  cashCollected(@Query() query: CashCollectedQueryDto): Promise<CashCollectedSummary> {
    return this.payments.cashCollected(query.orderIds);
  }

  // HQ refund-approval queue (feature 14a): cross-depot pending refunds above the HQ
  // threshold, newest first. Declared before ':id' so the static segment wins.
  @ApiOkResponse({ type: PagedRefundQueueResponseDto })
  @Get('refunds/queue')
  @Can('refundQueue')
  @ApiOperation({ summary: 'List refunds awaiting HQ approval (finance/super-admin)' })
  listRefundQueue(@Query() query: ListPaymentsQueryDto): Promise<Page<RefundQueueRow>> {
    return this.payments.listRefundQueue(query);
  }

  @ApiOkResponse({ type: PaymentResponseDto })
  @Get(':id')
  @ApiOperation({ summary: "Get one of the current customer's payments" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.getForCustomer(user.sub, id);
  }

  @ApiOkResponse({ type: PaymentResponseDto })
  @Post(':id/confirm')
  @Can('paymentSettle')
  @ApiOperation({ summary: 'Confirm a payment as settled (staff, e.g. cash received)' })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.confirm(id, user.sub, dto.cashReceived);
  }

  @ApiOkResponse({ type: PaymentResponseDto })
  @Post(':id/fail')
  @Can('paymentSettle')
  @ApiOperation({ summary: 'Mark a pending payment as failed (staff)' })
  fail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.fail(id, user.sub);
  }

  @ApiOkResponse({ type: PaymentResponseDto })
  @Post(':id/refund')
  @Can('refundIssue')
  @ApiOperation({ summary: 'Refund a paid payment (finance/manager)' })
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.refund(id, user.sub, dto.reason);
  }

  @ApiOkResponse({ type: PaymentResponseDto })
  @Post(':id/refund/approve')
  @Can('refundQueue')
  @ApiOperation({ summary: 'Approve a queued refund → settles now (HQ)' })
  approveRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.approveRefund(id, user.sub);
  }

  @ApiOkResponse({ type: PaymentResponseDto })
  @Post(':id/refund/reject')
  @Can('refundQueue')
  @ApiOperation({ summary: 'Reject a queued refund → no money moves (HQ)' })
  rejectRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.rejectRefund(id, user.sub, dto.reason);
  }

  @ApiOkResponse({ type: Webhook3ResponseDto })
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider settlement webhook (HMAC-signed, no bearer token)' })
  webhook(@Body() dto: PaymentWebhookDto): Promise<{ handled: boolean }> {
    return this.payments.handleWebhook(dto);
  }
}
