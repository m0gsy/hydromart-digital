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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Public, Role, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { PaymentService } from '../application/services/payment.service';
import { PaymentRecord, UnsettledMethodAggregate } from '../application/ports/payment.repository';
import { Page } from '../application/pagination';
import {
  InitiatePaymentDto,
  ListPaymentsQueryDto,
  PaymentWebhookDto,
  RefundPaymentDto,
  UnsettledByMethodQueryDto,
} from './dto/payment.dto';

// Settlement roles (confirm/fail/read-by-order) come from the shared capability map.
// Refunds stay a narrower finance/manager action.
const REFUND_ROLES = [Role.FINANCE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;
// HQ refund-approval queue (feature 14a): cross-depot, finance/super-admin only.
const REFUND_QUEUE_ROLES = [Role.FINANCE, Role.SUPER_ADMIN] as const;
// HQ settlement dashboard (design 6a): read-only network aggregate, finance/super-admin.
const SETTLEMENT_READ_ROLES = [Role.FINANCE, Role.SUPER_ADMIN] as const;

@ApiTags('Payments')
@ApiBearerAuth()
@Controller({ path: 'payments', version: '1' })
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post()
  @ApiOperation({ summary: 'Initiate a payment for an order' })
  initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitiatePaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.initiate(user.sub, dto);
  }

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
  @Get('for-order/:orderId')
  @Roles(...CAPABILITIES.paymentSettle)
  @ApiOperation({ summary: "List an order's payments (staff, for settlement)" })
  listForOrder(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<Page<PaymentRecord>> {
    return this.payments.listAll({ orderId, limit: 20 });
  }

  // HQ settlement dashboard (design 6a): network-wide unsettled payments grouped by
  // method. Declared before ':id' so the static segment wins. Read-only aggregate.
  @Get('unsettled-by-method')
  @Roles(...SETTLEMENT_READ_ROLES)
  @ApiOperation({ summary: 'Network unsettled payments grouped by method (finance/super-admin)' })
  unsettledByMethod(
    @Query() query: UnsettledByMethodQueryDto,
  ): Promise<UnsettledMethodAggregate[]> {
    return this.payments.unsettledByMethod({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  // HQ refund-approval queue (feature 14a): cross-depot pending refunds above the HQ
  // threshold, newest first. Declared before ':id' so the static segment wins.
  @Get('refunds/queue')
  @Roles(...REFUND_QUEUE_ROLES)
  @ApiOperation({ summary: 'List refunds awaiting HQ approval (finance/super-admin)' })
  listRefundQueue(@Query() query: ListPaymentsQueryDto): Promise<Page<PaymentRecord>> {
    return this.payments.listRefundQueue(query);
  }

  @Get(':id')
  @ApiOperation({ summary: "Get one of the current customer's payments" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.getForCustomer(user.sub, id);
  }

  @Post(':id/confirm')
  @Roles(...CAPABILITIES.paymentSettle)
  @ApiOperation({ summary: 'Confirm a payment as settled (staff, e.g. cash received)' })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.confirm(id, user.sub);
  }

  @Post(':id/fail')
  @Roles(...CAPABILITIES.paymentSettle)
  @ApiOperation({ summary: 'Mark a pending payment as failed (staff)' })
  fail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.fail(id, user.sub);
  }

  @Post(':id/refund')
  @Roles(...REFUND_ROLES)
  @ApiOperation({ summary: 'Refund a paid payment (finance/manager)' })
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.refund(id, user.sub, dto.reason);
  }

  @Post(':id/refund/approve')
  @Roles(...REFUND_QUEUE_ROLES)
  @ApiOperation({ summary: 'Approve a queued refund → settles now (HQ)' })
  approveRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.approveRefund(id, user.sub);
  }

  @Post(':id/refund/reject')
  @Roles(...REFUND_QUEUE_ROLES)
  @ApiOperation({ summary: 'Reject a queued refund → no money moves (HQ)' })
  rejectRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.rejectRefund(id, user.sub, dto.reason);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider settlement webhook (HMAC-signed, no bearer token)' })
  webhook(@Body() dto: PaymentWebhookDto): Promise<{ handled: boolean }> {
    return this.payments.handleWebhook(dto);
  }
}
