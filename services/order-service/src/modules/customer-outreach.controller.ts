import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuditMutationsInterceptor, Can, ExternalAccess, InternalAuthGuard, Public } from '@hydromart/platform';

import { CustomerOutreachService } from '../application/services/customer-outreach.service';
import { DueWindowDto, MachineOrdersByPhoneDto, MachineOrdersResultDto } from './dto/customer-outreach.dto';

/**
 * HD-18: where is my order, for one WhatsApp number. Only n8n's machine account (scope
 * `orderStatusByPhone`) reaches it. POST with the number in the body, never in a query string, so
 * the access log (which prints the URL) cannot hold it; the audit interceptor redacts `msisdn`.
 */
@ApiTags('Machine')
@ApiBearerAuth()
@Controller({ path: 'machine/orders', version: '1' })
export class MachineOrdersController {
  constructor(private readonly outreach: CustomerOutreachService) {}

  @ApiOkResponse({ type: MachineOrdersResultDto })
  @ExternalAccess('machine')
  @Can('orderStatusByPhone')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('by-phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'n8n: the orders of one WhatsApp number (running + last 3 finished), HD-18' })
  byPhone(@Body() dto: MachineOrdersByPhoneDto) {
    return this.outreach.statusByPhone(dto.msisdn);
  }
}

/** HD-18: who crm should remind. Internal key only; customer ids never leave hydromart. */
@ApiTags('Reports')
@Controller({ path: 'customer-reminders/internal', version: '1' })
export class CustomerRemindersInternalController {
  constructor(private readonly outreach: CustomerOutreachService) {}

  @ApiOkResponse({ description: 'items: id, customerId, productName, quantity, nextDeliveryAt.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('subscriptions-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACTIVE subscriptions delivering inside [from, to) (internal service auth)' })
  subscriptionsDue(@Body() dto: DueWindowDto) {
    return this.outreach.subscriptionsDue(new Date(dto.from), new Date(dto.to));
  }

  @ApiOkResponse({ description: 'items: orderId, customerId, orderNumber, total.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('unpaid-orders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer/QR orders unpaid and close to the auto-cancel (internal service auth)' })
  unpaidOrders() {
    return this.outreach.unpaidOrders(new Date());
  }
}
