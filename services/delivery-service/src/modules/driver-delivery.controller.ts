import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { DeliveryService } from '../application/services/delivery.service';
import { DeliveryRecord } from '../application/ports/delivery.repository';
import { Page } from '../application/pagination';
import { FailDeliveryDto, ListDeliveriesQueryDto, ProofOfDeliveryDto } from './dto/delivery.dto';

/** Driver-facing view: a driver only ever sees and acts on their own deliveries. */
@ApiTags('Driver Deliveries')
@ApiBearerAuth()
@Roles(Role.DRIVER)
@Controller({ path: 'driver/deliveries', version: '1' })
export class DriverDeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get()
  @ApiOperation({ summary: "List the current driver's deliveries" })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<Page<DeliveryRecord>> {
    return this.deliveries.listForDriver(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: "Get one of the driver's deliveries" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeliveryRecord> {
    return this.deliveries.getForDriver(user.sub, id);
  }

  @Patch(':id/pickup')
  @ApiOperation({ summary: 'Mark the order picked up (advances the order to PICKED_UP)' })
  pickup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization: string,
  ): Promise<DeliveryRecord> {
    return this.deliveries.pickup(user.sub, id, authorization);
  }

  @Patch(':id/start')
  @ApiOperation({ summary: 'Start delivery (advances the order to ON_DELIVERY)' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') authorization: string,
  ): Promise<DeliveryRecord> {
    return this.deliveries.start(user.sub, id, authorization);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete delivery with proof (advances the order to DELIVERED)' })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProofOfDeliveryDto,
    @Headers('authorization') authorization: string,
  ): Promise<DeliveryRecord> {
    return this.deliveries.complete(
      user.sub,
      id,
      {
        photoUrl: dto.photoUrl,
        signatureUrl: dto.signatureUrl,
        recipientName: dto.recipientName,
        latitude: dto.latitude,
        longitude: dto.longitude,
        note: dto.note ?? null,
      },
      authorization,
    );
  }

  @Patch(':id/fail')
  @ApiOperation({ summary: 'Mark the delivery failed' })
  fail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailDeliveryDto,
  ): Promise<DeliveryRecord> {
    return this.deliveries.fail(user.sub, id, dto.reason);
  }
}
