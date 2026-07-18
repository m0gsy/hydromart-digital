import {
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
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
  Role,
  Roles,
  assertDepotAccess,
  depotScopeFilter,
} from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { OrderStatus } from '../domain/order-status';
import { CartView } from '../application/services/cart.service';
import { OrderService } from '../application/services/order.service';
import {
  OrderRecord,
  OrderReviewRecord,
  OrderStatusHistoryRecord,
  RatingSummary,
} from '../application/ports/order.repository';
import { Page } from '../application/pagination';
import {
  CancelOrderDto,
  CheckoutDto,
  CreateReviewDto,
  InternalRefundDto,
  ListOrdersQueryDto,
  RatingBatchDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';

// Staff roles permitted to advance an order through its lifecycle (BR-012).
const FULFILMENT_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.DRIVER,
  Role.SUPER_ADMIN,
] as const;

@ApiTags('Orders')
@ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Place an order from the cart (prices re-verified server-side)' })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutDto,
    @Headers('authorization') authorization?: string,
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
        voucherCode: dto.voucherCode ?? null,
        deliveryWindow: dto.deliveryWindow ?? null,
      },
      authorization,
    );
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('expire-abandoned')
  @ApiOperation({ summary: 'Auto-cancel unconfirmed abandoned orders, releasing their stock (admin sweep)' })
  expireAbandoned(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization?: string,
    @Query('olderThanMinutes') olderThanMinutes?: string,
  ): Promise<{ cancelled: number }> {
    const minutes = olderThanMinutes ? Number(olderThanMinutes) : undefined;
    return this.orders.expireAbandoned(
      user.sub,
      authorization,
      minutes && minutes > 0 ? minutes : undefined,
    );
  }

  @Get()
  @ApiOperation({ summary: "List the current customer's orders" })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Page<OrderRecord>> {
    return this.orders.listForCustomer(user.sub, query);
  }

  // Static `manage` routes are declared before `:id` so they are not captured by it.
  @Get('manage')
  @Roles(...CAPABILITIES.orderQueue)
  @ApiOperation({ summary: 'Staff order queue across all customers, optional status filter' })
  listManaged(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Page<OrderRecord>> {
    // Scope the list to the caller's depot for depot-locked roles (operator/manager can't
    // see other depots); HQ/finance/etc. keep the optional ?depotId filter, undefined = all.
    const depotId = depotScopeFilter(user, query.depotId);
    return this.orders.listAll({ ...query, depotId });
  }

  @Get('manage/:id')
  @Roles(...CAPABILITIES.orderQueue)
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
      items: { productId: string; productName: string; sku: string; unit: string; quantity: number }[];
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

  // Ops/scheduler-triggered "time to refill" sweep (internal service auth, spec 5h).
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('reminders/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Notify customers with a stale last order (internal service auth)' })
  remindStale(
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ): Promise<{ reminded: number }> {
    return this.orders.remindStaleCustomers(
      new Date(),
      days ? Number(days) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: "Get one of the current customer's orders" })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderRecord> {
    return this.orders.getForCustomer(user.sub, id);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: "Get the status history of one of the customer's orders" })
  async timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderStatusHistoryRecord[]> {
    const order = await this.orders.getForCustomer(user.sub, id);
    return order.history;
  }

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

  @Post(':id/repeat')
  @ApiOperation({ summary: "Re-add an order's available items back to the cart" })
  repeat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CartView> {
    return this.orders.repeat(user.sub, id);
  }

  @Get(':id/review')
  @ApiOperation({ summary: "Get the customer's review of an order (null if unrated)" })
  getReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderReviewRecord | null> {
    return this.orders.getReview(user.sub, id);
  }

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

  // Service-to-service: delivery-service reads a courier's mean rating over the orders
  // delivered in a week (design 4c). Internal key auth, same fail-closed path as above.
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('reviews/ratings/internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mean rating over a set of orders (internal service auth)' })
  ratingBatch(@Body() dto: RatingBatchDto): Promise<RatingSummary> {
    return this.orders.ratingSummary(dto.orderIds);
  }

  @Patch(':id/status')
  @Roles(...FULFILMENT_ROLES)
  @ApiOperation({ summary: 'Advance an order to the next status (staff, BR-012)' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Headers('authorization') authorization?: string,
  ): Promise<OrderRecord> {
    // Close the by-id vector: a depot-locked operator/manager may only advance their own
    // depot's order. No-op for DRIVER/SUPER_ADMIN. Load first so the check precedes the mutation.
    const existing = await this.orders.getAny(id);
    assertDepotAccess(user, existing.depotId);
    // Forward the caller's token so order-service can award loyalty points on
    // completion (BR-013); loyalty-service enforces its own RBAC on the earn.
    return this.orders.updateStatus(id, dto.status, user.sub, dto.note, authorization, dto.driverName);
  }
}
