import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser, assertDepotAccess } from '@hydromart/platform';

import { SubscriptionService } from '../application/services/subscription.service';
import { Subscription } from '../domain/subscription';
import { CreateSubscriptionDto, ListSubscriptionQueryDto } from './dto/subscription.dto';
import { SubscriptionResponseDto } from './dto/responses.generated.dto';

/** Customer recurring subscriptions (design 16b). */
@ApiTags('Subscriptions')
@ApiBearerAuth()
@Can('depotSubscriptions')
@Controller({ path: 'subscriptions', version: '1' })
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @ApiOkResponse({ type: SubscriptionResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "List a depot's subscriptions (newest first), optional status filter" })
  list(@Query() query: ListSubscriptionQueryDto): Promise<Subscription[]> {
    return this.subscriptions.list(query.depotId, { status: query.status });
  }

  @ApiOkResponse({ type: SubscriptionResponseDto })
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

  @ApiOkResponse({ type: SubscriptionResponseDto })
  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause a subscription' })
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Subscription> {
    assertDepotAccess(user, (await this.subscriptions.get(id)).depotId);
    return this.subscriptions.pause(id);
  }

  @ApiOkResponse({ type: SubscriptionResponseDto })
  @Patch(':id/resume')
  @ApiOperation({ summary: 'Resume a subscription' })
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Subscription> {
    assertDepotAccess(user, (await this.subscriptions.get(id)).depotId);
    return this.subscriptions.resume(id);
  }
}
