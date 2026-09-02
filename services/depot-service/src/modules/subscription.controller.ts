import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import {
  Can,
  CurrentUser,
  AuthenticatedUser,
  InternalAuthGuard,
  Public,
  assertDepotAccess,
} from '@hydromart/platform';

import { SubscriptionService } from '../application/services/subscription.service';
import { Subscription } from '../domain/subscription';
import { CreateSubscriptionDto, ListSubscriptionQueryDto } from './dto/subscription.dto';
import {
  SubscriptionNetworkCountsResponseDto,
  SubscriptionResponseDto,
} from './dto/responses.generated.dto';

/** Customer recurring subscriptions (design 16b). */
@ApiTags('Subscriptions')
@ApiBearerAuth()
@Can('depotSubscriptions')
@Controller({ path: 'subscriptions', version: '1' })
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  /**
   * Which of this depot's customers actually hold a subscription, for the depot CRM
   * directory (S2) — where `isSubscriber` was a hardcoded null on every row.
   *
   * Ids only: the caller is customer-service filling in one boolean per person, and the
   * subscription's product, cadence and note are none of its business. Internal key,
   * `@Public()` short-circuits the class-level @Can. Declared FIRST so the static segment wins.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/customer-ids')
  @ApiOperation({ summary: "Linked customer ids with an ACTIVE subscription at one depot (internal)" })
  @ApiOkResponse({ description: 'Distinct customer ids holding an active subscription.' })
  activeCustomerIds(
    @Query('depotId', ParseUUIDPipe) depotId: string,
  ): Promise<{ customerIds: string[] }> {
    return this.subscriptions
      .activeCustomerIds(depotId)
      .then((customerIds) => ({ customerIds }));
  }

  /**
   * K1.11 · the depot-created half of the subscription population, counted network-wide.
   *
   * `hqConsole` and not the class-level `depotSubscriptions`: the caller is HQ reading a
   * network figure, not a manager acting on one depot's plans, and `depotSubscriptions` is
   * MANAGER/SUPER_ADMIN — it would 403 exactly the HEAD_OFFICE reader this exists for. The
   * same capability order-service's own `subscriptions/admin/summary` uses, because the two
   * halves now sit side by side on one screen.
   *
   * Declared before `@Get()` so the static `admin` segment wins.
   */
  @ApiOkResponse({ type: SubscriptionNetworkCountsResponseDto })
  @Can('hqBackOffice')
  @Get('admin/summary')
  @ApiOperation({ summary: 'Network aggregate of depot-created subscriptions (18c)' })
  networkSummary(): Promise<{ activeSubscriptions: number; activeSubscribers: number }> {
    return this.subscriptions.networkSummary();
  }

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
      customerId: dto.customerId,
      customerName: dto.customerName,
      productLabel: dto.productLabel,
      productId: dto.productId,
      quantity: dto.quantity,
      cadence: dto.cadence,
      // D10: what the operator picks is the FIRST delivery. The engine owns every date
      // after it, so there is no second schedule living here to drift out of step.
      firstDeliveryAt: new Date(dto.firstDeliveryAt),
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
