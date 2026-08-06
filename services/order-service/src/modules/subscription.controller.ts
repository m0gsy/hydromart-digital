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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { SubscriptionRecord } from '../application/ports/subscription.repository';
import { SubscriptionService } from '../application/services/subscription.service';
import { CreateSubscriptionDto, DepotScopeQueryDto } from './dto/order.dto';
import { SubscriptionNetworkSummaryView } from '../application/services/subscription.service';
import { Discount2ResponseDto, ProcessDue2ResponseDto, SubscriptionNetworkSummaryResponseDto, SubscriptionResponseDto } from './dto/responses.generated.dto';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller({ path: 'subscriptions', version: '1' })
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @ApiOkResponse({ type: SubscriptionResponseDto, isArray: true })
  @Roles(Role.CUSTOMER)
  @Get()
  @ApiOperation({ summary: "List the current customer's subscriptions (spec 7b)" })
  list(@CurrentUser() user: AuthenticatedUser): Promise<SubscriptionRecord[]> {
    return this.subscriptions.list(user.sub);
  }

  // Public like loyalty's tier ladder, and for the same reason: the shop must quote the
  // saving before anyone signs in, and a discount rate is not private.
  @ApiOkResponse({ type: Discount2ResponseDto })
  @Public()
  @Get('discount')
  @ApiOperation({ summary: "A depot's subscription discount rate (spec 7b)" })
  discount(@Query() query: DepotScopeQueryDto): { rate: number } {
    return { rate: this.subscriptions.discountRate(query.depotId ?? null) };
  }

  @ApiOkResponse({ type: SubscriptionNetworkSummaryResponseDto })
  @Can('hqConsole')
  @Get('admin/summary')
  @ApiOperation({ summary: 'HQ network subscription aggregate (18c)' })
  adminSummary(): Promise<SubscriptionNetworkSummaryView> {
    return this.subscriptions.networkSummary();
  }

  @ApiOkResponse({ type: SubscriptionResponseDto })
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

  @ApiOkResponse({ type: SubscriptionResponseDto })
  @Roles(Role.CUSTOMER)
  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a subscription' })
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionRecord> {
    return this.subscriptions.pause(user.sub, id);
  }

  @ApiOkResponse({ type: SubscriptionResponseDto })
  @Roles(Role.CUSTOMER)
  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused subscription' })
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionRecord> {
    return this.subscriptions.resume(user.sub, id);
  }

  @ApiOkResponse({ type: SubscriptionResponseDto })
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
  @ApiOkResponse({ type: ProcessDue2ResponseDto })
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
