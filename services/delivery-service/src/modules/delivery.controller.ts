import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Roles, assertDepotAccess, depotScopeFilter } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { DeliveryService } from '../application/services/delivery.service';
import { DeliveryRecord } from '../application/ports/delivery.repository';
import { Page } from '../application/pagination';
import { AssignDeliveryDto, ListDeliveriesQueryDto } from './dto/delivery.dto';

@ApiTags('Deliveries (staff)')
@ApiBearerAuth()
@Roles(...CAPABILITIES.tracking)
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
    const depotId = depotScopeFilter(user, query.depotId);
    return this.deliveries.listAll({ ...query, depotId });
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
