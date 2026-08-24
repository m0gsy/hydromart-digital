import {
  ForbiddenException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, InternalAuthGuard, Public, Role, Roles, assertDepotAccess, depotScopeIds } from '@hydromart/platform';

import { OrderStatus } from '../domain/order-status';
import { CartView } from '../application/services/cart.service';
import { AbandonedSweepResult, OrderService } from '../application/services/order.service';
import { OutboxService, OutboxSweepResult } from '../application/services/outbox.service';
import {
  OrderRecord,
  OrderReviewRecord,
  OrderStatusHistoryRecord,
  RatingSummary,
} from '../application/ports/order.repository';
import { Page } from '../application/pagination';
import {
  AssignDepotDto,
  CancelOrderDto,
  CheckoutDto,
  CounterBuyerResponseDto,
  CounterIdentifyDto,
  CounterQuoteDto,
  CounterQuoteResponseDto,
  CreateReviewDto,
  DeliveryOptionsResponseDto,
  InternalRefundDto,
  ListOrdersQueryDto,
  OrderValueBatchDto,
  OrderValueDto,
  RatingBatchDto,
  UpdateOrderStatusDto,
  VoidSaleDto,
  WalkInSaleDto,
} from './dto/order.dto';
import { CartResponseDto, ExpireAbandoned2ResponseDto, InternalCompleted2ResponseDto, InternalConfirm2ResponseDto, InternalCustomerOrdersResponseDto, InternalDepotCustomers2ResponseDto, InternalDepotSales2ResponseDto, InternalRefund2ResponseDto, InternalTotal2ResponseDto, OrderResponseDto, OrderReviewResponseDto, OrderStatusHistoryResponseDto, PagedOrderResponseDto, RatingResponseDto, RemindStale2ResponseDto } from './dto/responses.generated.dto';

// Staff roles permitted to advance an order through its lifecycle (BR-012).
@ApiTags('Orders')
@ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly outboxService: OutboxService,
  ) {}

  @ApiOkResponse({ type: OrderResponseDto })
  @Post('checkout')
  @ApiOperation({ summary: 'Place an order from the cart (prices re-verified server-side)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Unique per checkout attempt. Re-sending it returns the order the first attempt placed instead of a second one.',
  })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutDto,
    @Headers('authorization') authorization?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrderRecord> {
    // Forward the caller's token so checkout can validate/redeem a voucher against
    // the promo-service (which enforces its own RBAC on quote/redeem).
    return this.orders.checkout(
      user.sub,
      {
        deliveryAddress: {
          recipientName: dto.deliveryAddress.recipientName,
          phone: dto.deliveryAddress.phone,
          addressLine: dto.deliveryAddress.addressLine,
          city: dto.deliveryAddress.city,
          province: dto.deliveryAddress.province,
          postalCode: dto.deliveryAddress.postalCode ?? null,
          latitude: dto.deliveryAddress.latitude ?? null,
          longitude: dto.deliveryAddress.longitude ?? null,
          notes: dto.deliveryAddress.notes ?? null,
        },
        depotId: dto.depotId ?? null,
        voucherCode: dto.voucherCode ?? null,
        deliveryWindow: dto.deliveryWindow ?? null,
        express: dto.express ?? false,
        idempotencyKey: idempotencyKey ?? null,
      },
      authorization,
    );
  }

  // Declared before any ':id' route so 'delivery-options' is never read as an order id.
  @ApiOkResponse({ type: DeliveryOptionsResponseDto })
  @Get('delivery-options')
  @ApiOperation({
    summary: 'Delivery windows and express pricing offered by a depot',
    description:
      'What the checkout screen may offer. The express surcharge here is the one the order will be charged — the screen never carries its own price.',
  })
  deliveryOptions(@Query('depotId') depotId?: string): Promise<DeliveryOptionsResponseDto> {
    return this.orders.deliveryOptions(depotId ?? null);
  }

  // Declared before any ':id' route so 'walk-in' is never read as an order id.
  @ApiOkResponse({ type: OrderResponseDto })
  @Can('walkInSale')
  @Post('walk-in')
  @ApiOperation({ summary: 'Record a cash sale at the depot counter (completed immediately)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Unique per till attempt. Re-sending it returns the same sale, not a second one.',
  })
  walkIn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: WalkInSaleDto,
    @Headers('authorization') authorization?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrderRecord> {
    return this.orders.walkInSale(
      user,
      {
        depotId: dto.depotId,
        lines: dto.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        customerId: dto.customerId ?? null,
        customerName: dto.customerName ?? null,
        customerPhone: dto.customerPhone ?? null,
        voucherCode: dto.voucherCode ?? null,
        idempotencyKey: idempotencyKey ?? null,
        // C11: present = deliver it, absent = the counter behaviour that was always here.
        // Mapped field by field like checkout, so an optional DTO field cannot arrive as
        // `undefined` in a column the snapshot declares as nullable-but-present.
        deliveryAddress: dto.deliveryAddress
          ? {
              recipientName: dto.deliveryAddress.recipientName,
              phone: dto.deliveryAddress.phone,
              addressLine: dto.deliveryAddress.addressLine,
              city: dto.deliveryAddress.city,
              province: dto.deliveryAddress.province,
              postalCode: dto.deliveryAddress.postalCode ?? null,
              latitude: dto.deliveryAddress.latitude ?? null,
              longitude: dto.deliveryAddress.longitude ?? null,
              notes: dto.deliveryAddress.notes ?? null,
            }
          : null,
      },
      authorization,
    );
  }

  /**
   * C12 · what this basket actually costs, answered by the server.
   *
   * The cashier screen used to add up shelf prices itself while the server applied tier,
   * agen and voucher on top. Three numbers, three places: the cash-short guard refused an
   * agen handing over exact money, the change on screen disagreed with the change on the
   * receipt, and a cashier who trusted the screen collected more than was recorded — a
   * phantom surplus at shift close.
   *
   * Runs the SAME function the sale runs. No shift check, no stock reservation, no voucher
   * redemption: this prices, it does not sell.
   *
   * `customerId` is optional and there is deliberately NO phone field. Resolving a phone
   * mints an account, so a quote that accepted one would print a customer on every
   * keystroke — people who never bought anything, sitting in the broadcast audience, who
   * will never switch the opt-out off because nobody is behind them. Identifying the buyer
   * is the separate, deliberate tap below.
   *
   * Declared before any ':id' route so the static segment wins.
   */
  @ApiOkResponse({ type: CounterQuoteResponseDto })
  @Can('walkInSale')
  @Post('walk-in/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price a counter basket without selling it (cashier screen)' })
  async walkInQuote(
    @Body() dto: CounterQuoteDto,
    @Headers('authorization') authorization?: string,
  ): Promise<CounterQuoteResponseDto> {
    return CounterQuoteResponseDto.from(
      await this.orders.quoteCounterBasket(
        dto.customerId ?? null,
        dto.depotId,
        dto.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        dto.voucherCode ?? null,
        authorization,
      ),
    );
  }

  /**
   * C12 · identify the buyer, once, because the cashier asked.
   *
   * This is the tap that may create an account, and it exists so that nothing else does it
   * by accident. The quote above never resolves a phone; the sale still resolves one when
   * a sale actually happens, which is a customer who really bought something.
   */
  @ApiOkResponse({ type: CounterBuyerResponseDto })
  @Can('walkInSale')
  @Post('walk-in/identify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a counter buyer by phone, on the cashier’s explicit request' })
  async walkInIdentify(
    @Body() dto: CounterIdentifyDto,
    @Headers('authorization') authorization?: string,
  ): Promise<CounterBuyerResponseDto> {
    return this.orders.identifyCounterBuyer(
      dto.depotId,
      dto.phone,
      dto.name ?? null,
      authorization,
    );
  }

  // Declared with the other 'walk-in' routes, before any ':id' route, so the static
  // segment is never read as an order id.
  @ApiOkResponse({ type: OrderResponseDto })
  @Can('walkInSale')
  @Post('walk-in/:id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reverse a counter sale at the till (same day only)' })
  voidWalkIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidSaleDto,
    @Headers('authorization') authorization?: string,
  ): Promise<OrderRecord> {
    return this.orders.voidCounterSale(user, id, dto.reason, new Date(), authorization);
  }

  /**
   * H-10: deliver the completion effects that are still owed — the stock consume, the
   * loyalty award, the referral qualification, the franchise-owner credit. Ops-scheduled,
   * exactly like expire-abandoned and the subscription sweep; this service runs no cron
   * daemon of its own.
   */
  @Roles(Role.SUPER_ADMIN)
  @Post('outbox/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry the order side effects still owed (admin sweep)' })
  @ApiOkResponse({ description: 'Counts for this sweep: claimed, delivered, failed, dead.' })
  processOutbox(): Promise<OutboxSweepResult> {
    return this.outboxService.processDue();
  }

  /**
   * The same sweep, for the scheduler.
   *
   * `outbox/process` above is SUPER_ADMIN-only, which is right for a human pressing it and
   * useless for crond: `sweep.sh` authenticates with `x-internal-key` and holds no JWT. So
   * for the whole life of the outbox there was no cron line for it, and there could not
   * have been — the retry path for a failed stock consume, loyalty award, referral
   * qualification or franchise-owner credit simply never ran. The happy path runs inline,
   * so nothing looked broken; a PENDING row just sat there with money owed against it.
   *
   * Same shape as `subscriptions/process-due` and `campaigns/internal/process-sending`:
   * @Public() takes it out of the global JWT guard, InternalAuthGuard is the only auth.
   */
  @ApiOkResponse({ description: 'Counts for this sweep: claimed, delivered, failed, dead.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('outbox/internal/process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry the order side effects still owed (scheduler sweep)' })
  processOutboxInternal(): Promise<OutboxSweepResult> {
    return this.outboxService.processDue();
  }

  /** What the sweep still owes, so a queue that stops draining is visible. */
  @Roles(Role.SUPER_ADMIN)
  @Get('outbox/pending')
  @ApiOperation({ summary: 'Counts of order side effects owed, delivered and given up on' })
  @ApiOkResponse({ description: 'Row counts keyed by outbox status (PENDING, DONE, DEAD).' })
  outboxPending(): Promise<Record<string, number>> {
    return this.outboxService.pending();
  }

  @ApiOkResponse({ type: ExpireAbandoned2ResponseDto })
  @Roles(Role.SUPER_ADMIN)
  @Post('expire-abandoned')
  @ApiOperation({
    summary: 'Auto-cancel unconfirmed abandoned orders, releasing their stock (admin sweep)',
  })
  expireAbandoned(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization?: string,
    @Query('olderThanMinutes') olderThanMinutes?: string,
  ): Promise<AbandonedSweepResult> {
    const minutes = olderThanMinutes ? Number(olderThanMinutes) : undefined;
    return this.orders.expireAbandoned(
      user.sub,
      authorization,
      minutes && minutes > 0 ? minutes : undefined,
    );
  }

  /**
   * Abandoned-order expiry, for the scheduler — same reason as the outbox sibling above:
   * the SUPER_ADMIN route cannot be called by crond, so it never had a cron line and
   * abandoned orders held their stock reservation indefinitely. A reservation nobody ever
   * releases is a slow leak into false out-of-stock.
   *
   * `changedBy` is a fixed system identifier rather than a user id, because there is no
   * user: the status-history row should say a sweep did this, not name whoever happened to
   * hold the admin token. The empty authorization is deliberate and safe — `releaseStock`
   * reaches depot-service with `x-internal-key` and ignores the bearer entirely.
   */
  @ApiOkResponse({ type: ExpireAbandoned2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/expire-abandoned')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Auto-cancel unconfirmed abandoned orders, releasing their stock (scheduler sweep)',
  })
  expireAbandonedInternal(): Promise<AbandonedSweepResult> {
    return this.orders.expireAbandoned('system:scheduler');
  }

  @ApiOkResponse({ type: PagedOrderResponseDto })
  @Get()
  @ApiOperation({ summary: "List the current customer's orders" })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Page<OrderRecord>> {
    return this.orders.listForCustomer(user.sub, query);
  }

  // Static `manage` routes are declared before `:id` so they are not captured by it.
  @ApiOkResponse({ type: PagedOrderResponseDto })
  @Get('manage')
  @Can('orderQueue')
  @ApiOperation({ summary: 'Staff order queue across all customers, optional status filter' })
  async listManaged(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Page<OrderRecord>> {
    // Scope the list to the caller's depot for depot-locked roles (operator/manager can't
    // see other depots); HQ/finance/etc. keep the optional ?depotId filter, undefined = all.
    //
    // A courier is pinned to their assigned depot here rather than via DEPOT_LOCKED_ROLES:
    // that set also drives the courier's OWN delivery/shift routes, where the depot comes
    // from the assigned delivery and locking the role globally locks the courier out of
    // their own work. Unscoped, one courier token listed every depot's orders — customer
    // names, addresses and phone numbers across the network — from a phone in the field.
    //
    // ponytail: pinned to the token's depotId, not to the couriers actual assignments. If
    // couriers ever float between depots in one shift, resolve it from delivery-service.
    let depotIds: readonly string[] | undefined;
    if (user.role === Role.STAFF_DEPOT) {
      if (!user.depotId) {
        // A courier token with no depot is a misconfigured account. Failing closed beats
        // falling through to the unscoped branch, which would hand them the whole network.
        throw new ForbiddenException('Akun kurir ini belum tertaut ke depot mana pun.');
      }
      depotIds = [user.depotId];
    } else {
      depotIds = depotScopeIds(user, query.depotId);
    }
    // The unrouted tray is HQ-only by construction: those orders belong to no depot, so
    // a depot-scoped caller has no claim on them.
    if (query.unrouted && depotIds !== undefined) {
      throw new ForbiddenException('Pesanan tanpa depot hanya bisa dilihat kantor pusat.');
    }
    // depotId is dropped from the spread on purpose: the scalar has been replaced by the
    // resolved set, and leaving a stale one on the input invites someone to read it again.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { depotId: _dropped, ...rest } = query;
    return this.orders.listAll({ ...rest, depotIds });
  }

  @ApiOkResponse({ type: OrderResponseDto })
  @Patch('manage/:id/depot')
  @Can('orderQueue')
  @ApiOperation({ summary: 'Staff: assign the fulfilling depot of an order that has none' })
  assignDepot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDepotDto,
    // K2.7: the bearer is forwarded because assigning a depot now reserves its stock, and
    // depot-service's reserve is an authenticated call like the one checkout makes.
    @Headers('authorization') authorization?: string,
  ): Promise<OrderRecord> {
    return this.orders.assignDepot(id, dto.depotId, authorization);
  }

  @ApiOkResponse({ type: OrderResponseDto })
  @Get('manage/:id')
  @Can('orderQueue')
  @ApiOperation({ summary: 'Staff: read any order by id' })
  async getManaged(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderRecord> {
    const order = await this.orders.getAny(id);
    // Close the by-id vector: a depot-locked operator/manager may only read their own depot's order.
    assertDepotAccess(user, order.depotId);
    return order;
  }

  // Service-to-service: recommendation-service pulls completed orders for its rebuild
  // backfill. No end-user token — authenticated by the shared INTERNAL_SERVICE_KEY.
  // Declared before `:id` (mirrors `manage`) so it is not captured by that param route.
  @ApiOkResponse({ type: InternalCompleted2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/completed')
  @ApiOperation({ summary: 'Paged feed of COMPLETED orders (internal service auth)' })
  async internalCompleted(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    orders: {
      id: string;
      customerId: string;
      depotId: string | null;
      completedAt: Date;
      total: number;
      items: {
        productId: string;
        productName: string;
        sku: string;
        unit: string;
        quantity: number;
      }[];
    }[];
    nextCursor: string | null;
  }> {
    const { orders, nextCursor } = await this.orders.listCompletedPage(
      cursor ?? null,
      limit ? Number(limit) : undefined,
    );
    return {
      orders: orders.map((o) => ({
        id: o.id,
        customerId: o.customerId,
        depotId: o.depotId,
        completedAt: o.updatedAt,
        total: Math.round(o.total),
        items: o.items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          sku: i.sku,
          unit: i.unit,
          quantity: i.quantity,
        })),
      })),
      nextCursor,
    };
  }

  @ApiOkResponse({ type: InternalDepotSales2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/depot-sales')
  @ApiOperation({ summary: 'Sum of fulfilled depot sales in a date range (internal service auth)' })
  async internalDepotSales(
    @Query('depotId') depotId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<{ depotId: string; totalIdr: number }> {
    return {
      depotId,
      totalIdr: await this.orders.sumDepotSales(depotId, new Date(from), new Date(to)),
    };
  }

  @ApiOkResponse({ type: InternalDepotCustomers2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/depot-customers')
  @ApiOperation({
    summary: 'Per-customer order aggregates for a depot CRM (internal service auth)',
  })
  async internalDepotCustomers(@Query('depotId') depotId: string): Promise<{
    customers: {
      customerId: string;
      name: string | null;
      phone: string | null;
      orderCount: number;
      totalSpent: number;
      firstOrderAt: string | null;
      lastOrderAt: string | null;
    }[];
  }> {
    const rows = await this.orders.depotCustomerAggregates(depotId);
    return {
      customers: rows.map((r) => ({
        customerId: r.customerId,
        name: r.name,
        phone: r.phone,
        orderCount: r.orderCount,
        totalSpent: Math.round(r.totalSpent),
        firstOrderAt: r.firstOrderAt ? r.firstOrderAt.toISOString() : null,
        lastOrderAt: r.lastOrderAt ? r.lastOrderAt.toISOString() : null,
      })),
    };
  }

  /**
   * The depot CRM detail screen's "Pesanan terakhir" list. Internal key, not a user
   * capability: the caller is customer-service assembling that screen and it holds no
   * token for the depot.
   */
  @ApiOkResponse({ type: InternalCustomerOrdersResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/customer-orders')
  @ApiOperation({ summary: "One customer's recent orders at one depot (internal service auth)" })
  async internalCustomerOrders(
    @Query('depotId', ParseUUIDPipe) depotId: string,
    @Query('customerId', ParseUUIDPipe) customerId: string,
    @Query('limit') limit?: string,
  ): Promise<{
    orders: { id: string; orderNumber: string; status: string; totalIdr: number; placedAt: string }[];
  }> {
    const parsed = Number(limit);
    const rows = await this.orders.customerOrdersAtDepot(
      depotId,
      customerId,
      Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    );
    return {
      orders: rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        totalIdr: Math.round(o.total),
        placedAt: o.createdAt.toISOString(),
      })),
    };
  }

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/values')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch-read authoritative order totals (internal service auth)' })
  @ApiOkResponse({ type: [OrderValueDto] })
  internalValues(@Body() dto: OrderValueBatchDto): Promise<OrderValueDto[]> {
    return this.orders.findOrderValues(dto.orderIds);
  }

  // Ops/scheduler-triggered "time to refill" sweep (internal service auth, spec 5h).
  @ApiOkResponse({ type: RemindStale2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('reminders/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Notify customers with a stale last order (internal service auth)' })
  remindStale(
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ): Promise<{ reminded: number; failed: number; ok: boolean }> {
    return this.orders.remindStaleCustomers(
      new Date(),
      days ? Number(days) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @ApiOkResponse({ type: OrderResponseDto })
  @Get(':id')
  @ApiOperation({ summary: "Get one of the current customer's orders" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderRecord> {
    return this.orders.getForCustomer(user.sub, id);
  }

  @ApiOkResponse({ type: OrderStatusHistoryResponseDto, isArray: true })
  @Get(':id/timeline')
  @ApiOperation({ summary: "Get the status history of one of the customer's orders" })
  async timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderStatusHistoryRecord[]> {
    const order = await this.orders.getForCustomer(user.sub, id);
    return order.history;
  }

  @ApiOkResponse({ type: OrderResponseDto })
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an order (only before a driver is assigned, BR-006)' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
    @Headers('authorization') authorization?: string,
  ): Promise<OrderRecord> {
    return this.orders.cancel(user.sub, id, dto.reason, authorization);
  }

  @ApiOkResponse({ type: CartResponseDto })
  @Post(':id/repeat')
  @ApiOperation({ summary: "Re-add an order's available items back to the cart" })
  repeat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CartView> {
    return this.orders.repeat(user.sub, id);
  }

  @ApiOkResponse({ type: OrderReviewResponseDto })
  @Get(':id/review')
  @ApiOperation({ summary: "Get the customer's review of an order (null if unrated)" })
  getReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderReviewRecord | null> {
    return this.orders.getReview(user.sub, id);
  }

  @ApiOkResponse({ type: OrderReviewResponseDto })
  @Post(':id/review')
  @ApiOperation({ summary: 'Rate a delivered/completed order (spec 7c, one per order)' })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
  ): Promise<OrderReviewRecord> {
    return this.orders.reviewOrder(user.sub, id, {
      rating: dto.rating,
      aspects: dto.aspects ?? [],
      comment: dto.comment,
      tipAmount: dto.tipAmount,
    });
  }

  // Service-to-service: payment-service confirms an order once its payment settles PAID.
  // No end-user token — authenticated by the shared INTERNAL_SERVICE_KEY. @Public() skips
  // the global JWT guard; InternalAuthGuard is then the sole (fail-closed) auth.
  @ApiOkResponse({ type: InternalConfirm2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post(':id/internal-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an order after its payment settled (internal service auth)' })
  async internalConfirm(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ orderId: string; status: OrderStatus }> {
    const order = await this.orders.confirmPaid(id, 'payment-service');
    return { orderId: order.id, status: order.status };
  }

  // Records a settled refund amount on the order for per-depot reconciliation (22a).
  // Same internal service-auth path as internal-confirm.
  @ApiOkResponse({ type: InternalRefund2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post(':id/internal-refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a settled refund amount on an order (internal service auth)' })
  async internalRefund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InternalRefundDto,
  ): Promise<{ orderId: string }> {
    await this.orders.recordRefund(id, dto.amount);
    return { orderId: id };
  }

  // Service-to-service: payment-service validates a client-supplied payment amount
  // against the authoritative order total before charging (SEC-1, price-tampering).
  // Internal key auth, same fail-closed path as internal-confirm.
  @ApiOkResponse({ type: InternalTotal2ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get(':id/internal-total')
  @ApiOperation({ summary: 'Read an order total for payment validation (internal service auth)' })
  async internalTotal(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ orderId: string; total: number }> {
    const order = await this.orders.getAny(id);
    return { orderId: order.id, total: order.total };
  }

  // Service-to-service: delivery-service reads a courier's mean rating over the orders
  // delivered in a week (design 4c). Internal key auth, same fail-closed path as above.
  @ApiOkResponse({ type: RatingResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('reviews/ratings/internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mean rating over a set of orders (internal service auth)' })
  ratingBatch(@Body() dto: RatingBatchDto): Promise<RatingSummary> {
    return this.orders.ratingSummary(dto.orderIds);
  }

  @ApiOkResponse({ type: OrderResponseDto })
  @Patch(':id/status')
  @Can('orderFulfilment')
  @ApiOperation({ summary: 'Advance an order to the next status (staff, BR-012)' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Headers('authorization') authorization?: string,
  ): Promise<OrderRecord> {
    // Close the by-id vector: a depot-locked operator/manager may only advance their own
    // depot's order. No-op for STAFF_DEPOT/SUPER_ADMIN. Load first so the check precedes the mutation.
    const existing = await this.orders.getAny(id);
    assertDepotAccess(user, existing.depotId);
    // Forward the caller's token so order-service can award loyalty points on
    // completion (BR-013); loyalty-service enforces its own RBAC on the earn.
    return this.orders.updateStatus(
      id,
      dto.status,
      user.sub,
      dto.note,
      authorization,
      dto.driverName,
      dto.driverPhone,
      dto.estimatedArrivalAt,
    );
  }
}
