import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

import { DeliveryService } from '../application/services/delivery.service';
import { DeliveryRecord } from '../application/ports/delivery.repository';
import { Page } from '../application/pagination';
import { AssignDeliveryDto, ListDeliveriesQueryDto } from './dto/delivery.dto';

@ApiTags('Deliveries (staff)')
@ApiBearerAuth()
@Can('tracking')
@Controller({ path: 'deliveries', version: '1' })
export class DeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Post()
  @ApiOperation({ summary: 'Assign a driver to an order (advances the order to DRIVER_ASSIGNED)' })
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssignDeliveryDto,
    @Headers('authorization') authorization: string,
  ): Promise<DeliveryRecord> {
    return this.deliveries.assign(
      user.sub,
      {
        orderId: dto.orderId,
        orderNumber: dto.orderNumber,
        driverId: dto.driverId,
        driverName: dto.driverName,
        depotId: dto.depotId,
        destinationAddress: dto.destinationAddress,
        destinationLat: dto.destinationLat,
        destinationLng: dto.destinationLng,
        recipientPhone: dto.recipientPhone,
        driverPhone: dto.driverPhone,
        items: dto.items,
        codAmount: dto.codAmount,
        notes: dto.notes,
      },
      authorization,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all deliveries (staff), optionally filtered by status' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<Page<DeliveryRecord>> {
    // Depot-locked operator/manager are forced to their own depot; HQ keeps the optional ?depotId.
    const depotIds = depotScopeIds(user, query.depotId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { depotId: _dropped, ...rest } = query;
    return this.deliveries.listAll({ ...rest, depotIds });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get any delivery by id (staff)' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeliveryRecord> {
    const delivery = await this.deliveries.getAny(id);
    // Close the by-id vector: a depot-locked operator/manager may only read their own depot's delivery.
    assertDepotAccess(user, delivery.depotId);
    return delivery;
  }
}
