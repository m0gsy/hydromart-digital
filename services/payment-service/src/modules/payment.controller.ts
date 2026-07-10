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

import { PaymentService } from '../application/services/payment.service';
import { PaymentRecord } from '../application/ports/payment.repository';
import { Page } from '../application/pagination';
import {
  InitiatePaymentDto,
  ListPaymentsQueryDto,
  PaymentWebhookDto,
  RefundPaymentDto,
} from './dto/payment.dto';

// Staff who can settle/fail a payment (e.g. confirm cash on delivery).
const SETTLEMENT_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.DRIVER,
  Role.FINANCE,
  Role.SUPER_ADMIN,
] as const;

// Refunds are a finance/manager action.
const REFUND_ROLES = [Role.FINANCE, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

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

  @Get(':id')
  @ApiOperation({ summary: "Get one of the current customer's payments" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.getForCustomer(user.sub, id);
  }

  @Post(':id/confirm')
  @Roles(...SETTLEMENT_ROLES)
  @ApiOperation({ summary: 'Confirm a payment as settled (staff, e.g. cash received)' })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentRecord> {
    return this.payments.confirm(id, user.sub);
  }

  @Post(':id/fail')
  @Roles(...SETTLEMENT_ROLES)
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

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider settlement webhook (HMAC-signed, no bearer token)' })
  webhook(@Body() dto: PaymentWebhookDto): Promise<{ handled: boolean }> {
    return this.payments.handleWebhook(dto);
  }
}
