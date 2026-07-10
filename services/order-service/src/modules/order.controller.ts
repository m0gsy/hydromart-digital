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
} from '@hydromart/platform';

import { OrderStatus } from '../domain/order-status';
import { CartView } from '../application/services/cart.service';
import { OrderService } from '../application/services/order.service';
import { OrderRecord, OrderStatusHistoryRecord } from '../application/ports/order.repository';
import { Page } from '../application/pagination';
import {
  CancelOrderDto,
  CheckoutDto,
  ListOrdersQueryDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';

// Staff roles permitted to advance an order through its lifecycle (BR-012).
const FULFILMENT_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.DRIVER,
  Role.SUPER_ADMIN,
] as const;

// Staff roles permitted to read the cross-customer order queue (adds head-office
// oversight to the fulfilment roles).
const STAFF_READ_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.DRIVER,
  Role.HEAD_OFFICE,
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
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Staff order queue across all customers, optional status filter' })
  listManaged(@Query() query: ListOrdersQueryDto): Promise<Page<OrderRecord>> {
    return this.orders.listAll(query);
  }

  @Get('manage/:id')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Staff: read any order by id' })
  getManaged(@Param('id', ParseUUIDPipe) id: string): Promise<OrderRecord> {
    return this.orders.getAny(id);
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

  @Patch(':id/status')
  @Roles(...FULFILMENT_ROLES)
  @ApiOperation({ summary: 'Advance an order to the next status (staff, BR-012)' })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Headers('authorization') authorization?: string,
  ): Promise<OrderRecord> {
    // Forward the caller's token so order-service can award loyalty points on
    // completion (BR-013); loyalty-service enforces its own RBAC on the earn.
    return this.orders.updateStatus(id, dto.status, user.sub, dto.note, authorization);
  }
}
