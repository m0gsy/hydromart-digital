import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { PurchaseOrderService } from '../application/services/purchase-order.service';
import { PurchaseOrder } from '../domain/purchase-order';
import { CreatePurchaseOrderDto, PurchaseOrderQueryDto } from './dto/procurement.dto';
import { PurchaseOrderResponseDto } from './dto/responses.generated.dto';

/** Depot purchase orders (design 7a/9d). Receiving posts a RECEIPT movement per line. */
@ApiTags('Procurement')
@ApiBearerAuth()
@Can('procurement')
@Controller({ path: 'purchase-orders', version: '1' })
export class PurchaseOrderController {
  constructor(private readonly orders: PurchaseOrderService) {}

  @ApiOkResponse({ type: PurchaseOrderResponseDto })
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

  @ApiOkResponse({ type: PurchaseOrderResponseDto, isArray: true })
  @Get()
  @ApiOperation({
    summary: "List a depot's purchase orders (newest first), optional status filter",
  })
  list(@Query() query: PurchaseOrderQueryDto): Promise<PurchaseOrder[]> {
    return this.orders.list(query.depotId, { status: query.status });
  }

  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  @Get(':id')
  @ApiOperation({ summary: 'Get one purchase order' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseOrder> {
    const order = await this.orders.get(id);
    assertDepotAccess(user, order.depotId);
    return order;
  }

  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  @Post(':id/send')
  @ApiOperation({ summary: 'Send a DRAFT purchase order to the supplier (DRAFT → SENT)' })
  async send(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseOrder> {
    assertDepotAccess(user, (await this.orders.get(id)).depotId);
    return this.orders.send(id);
  }

  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  @Post(':id/receive')
  @ApiOperation({
    summary: 'Receive goods (SENT → RECEIVED); posts a RECEIPT per line to inventory',
  })
  async receive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurchaseOrder> {
    assertDepotAccess(user, (await this.orders.get(id)).depotId);
    return this.orders.receive(id, user.sub);
  }
}
