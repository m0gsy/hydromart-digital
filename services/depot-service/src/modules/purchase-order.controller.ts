import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { PurchaseOrderService } from '../application/services/purchase-order.service';
import { PurchaseOrder } from '../domain/purchase-order';
import { CreatePurchaseOrderDto, PurchaseOrderQueryDto } from './dto/procurement.dto';

/** Depot purchase orders (design 7a/9d). Receiving posts a RECEIPT movement per line. */
@ApiTags('Procurement')
@ApiBearerAuth()
@Roles(...CAPABILITIES.procurement)
@Controller({ path: 'purchase-orders', version: '1' })
export class PurchaseOrderController {
  constructor(private readonly orders: PurchaseOrderService) {}

  @Post()
  @ApiOperation({ summary: 'Create a DRAFT purchase order' })
  create(@Body() dto: CreatePurchaseOrderDto): Promise<PurchaseOrder> {
    return this.orders.create({
      depotId: dto.depotId,
      supplierId: dto.supplierId,
      lines: dto.lines,
      shippingIdr: dto.shippingIdr,
      expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
    });
  }

  @Get()
  @ApiOperation({ summary: "List a depot's purchase orders (newest first), optional status filter" })
  list(@Query() query: PurchaseOrderQueryDto): Promise<PurchaseOrder[]> {
    return this.orders.list(query.depotId, { status: query.status });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one purchase order' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrder> {
    return this.orders.get(id);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send a DRAFT purchase order to the supplier (DRAFT → SENT)' })
  send(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrder> {
    return this.orders.send(id);
  }

  @Post(':id/receive')
  @ApiOperation({ summary: 'Receive goods (SENT → RECEIVED); posts a RECEIPT per line to inventory' })
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseOrder> {
    return this.orders.receive(id, user.sub);
  }
}
