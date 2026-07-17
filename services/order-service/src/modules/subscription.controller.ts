import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
  Role,
  Roles,
} from '@hydromart/platform';

import { SubscriptionRecord } from '../application/ports/subscription.repository';
import { SubscriptionService } from '../application/services/subscription.service';
import { CreateSubscriptionDto } from './dto/order.dto';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller({ path: 'subscriptions', version: '1' })
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Roles(Role.CUSTOMER)
  @Get()
  @ApiOperation({ summary: "List the current customer's subscriptions (spec 7b)" })
  list(@CurrentUser() user: AuthenticatedUser): Promise<SubscriptionRecord[]> {
    return this.subscriptions.list(user.sub);
  }

  @Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
  @Get('admin/summary')
  @ApiOperation({ summary: 'HQ network subscription aggregate (18c)' })
  adminSummary() {
    return this.subscriptions.networkSummary();
  }

  @Roles(Role.CUSTOMER)
  @Post()
  @ApiOperation({ summary: 'Create a recurring galon subscription (spec 7b)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionRecord> {
    const a = dto.deliveryAddress;
    return this.subscriptions.create(user.sub, {
      productId: dto.productId,
      quantity: dto.quantity,
      frequency: dto.frequency,
      firstDeliveryAt: new Date(dto.firstDeliveryAt),
      address: {
        recipientName: a.recipientName,
        phone: a.phone,
        addressLine: a.addressLine,
        city: a.city,
        province: a.province,
        postalCode: a.postalCode ?? null,
        latitude: a.latitude ?? null,
        longitude: a.longitude ?? null,
        notes: a.notes ?? null,
      },
    });
  }

  @Roles(Role.CUSTOMER)
  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a subscription' })
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionRecord> {
    return this.subscriptions.pause(user.sub, id);
  }

  @Roles(Role.CUSTOMER)
  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused subscription' })
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionRecord> {
    return this.subscriptions.resume(user.sub, id);
  }

  @Roles(Role.CUSTOMER)
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a subscription' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionRecord> {
    return this.subscriptions.cancel(user.sub, id);
  }

  // Ops/scheduler-triggered fulfilment sweep (internal service auth, not a JWT).
  // @Public() bypasses the global JWT guard; InternalAuthGuard is the sole auth.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('process-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Place orders for all due subscriptions (internal, spec 7b)' })
  processDue(): Promise<{ placed: number }> {
    return this.subscriptions.processDue(new Date());
  }
}
