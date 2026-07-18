import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { SubscriptionService } from '../application/services/subscription.service';
import { Subscription } from '../domain/subscription';
import { CreateSubscriptionDto, ListSubscriptionQueryDto } from './dto/subscription.dto';

/** Customer recurring subscriptions (design 16b). */
@ApiTags('Subscriptions')
@ApiBearerAuth()
@Roles(...CAPABILITIES.depotCrm)
@Controller({ path: 'subscriptions', version: '1' })
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get()
  @ApiOperation({ summary: "List a depot's subscriptions (newest first), optional status filter" })
  list(@Query() query: ListSubscriptionQueryDto): Promise<Subscription[]> {
    return this.subscriptions.list(query.depotId, { status: query.status });
  }

  @Post()
  @ApiOperation({ summary: 'Create a customer subscription (ACTIVE)' })
  create(@Body() dto: CreateSubscriptionDto): Promise<Subscription> {
    return this.subscriptions.create({
      depotId: dto.depotId,
      customerId: dto.customerId ?? null,
      customerName: dto.customerName,
      productLabel: dto.productLabel,
      quantity: dto.quantity,
      cadence: dto.cadence,
      nextRunAt: dto.nextRunAt ? new Date(dto.nextRunAt) : null,
      note: dto.note ?? null,
    });
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause a subscription' })
  pause(@Param('id', ParseUUIDPipe) id: string): Promise<Subscription> {
    return this.subscriptions.pause(id);
  }

  @Patch(':id/resume')
  @ApiOperation({ summary: 'Resume a subscription' })
  resume(@Param('id', ParseUUIDPipe) id: string): Promise<Subscription> {
    return this.subscriptions.resume(id);
  }
}
