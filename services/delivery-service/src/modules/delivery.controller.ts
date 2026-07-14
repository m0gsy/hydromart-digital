import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';
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
      },
      authorization,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all deliveries (staff), optionally filtered by status' })
  list(@Query() query: ListDeliveriesQueryDto): Promise<Page<DeliveryRecord>> {
    return this.deliveries.listAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get any delivery by id (staff)' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DeliveryRecord> {
    return this.deliveries.getAny(id);
  }
}
