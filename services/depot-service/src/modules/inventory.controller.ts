import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  AuthenticatedUser,
  InternalAuthGuard,
  Public,
  Roles,
} from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { InventoryService, ItemView, WastageSummary } from '../application/services/inventory.service';
import { Page } from '../application/pagination';
import { PricingService, ResolvedProductPrice } from '../application/services/pricing.service';
import {
  DepotStockMovementRecord,
  StockMovementRecord,
} from '../application/ports/inventory.repository';
import {
  AdjustStockDto,
  ConsumeStockDto,
  CreateInventoryItemDto,
  ListInventoryQueryDto,
  ListStockMovementsQueryDto,
  OpnameStockDto,
  UpdateInventoryItemDto,
  WastageQueryDto,
} from './dto/inventory.dto';

// SEC-2: reserve/consume/release are service-to-service (order-service on checkout /
// cancel / completion), NOT end-user actions. They authenticate with the shared
// INTERNAL_SERVICE_KEY (fail-closed InternalAuthGuard) instead of trusting a forwarded
// customer/driver token — closing the stock-DoS and irreversible-deduct vectors.
const INVENTORY_ACTOR = 'order-service';

/** Stock lines nested under a depot (create + list). */
@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/inventory', version: '1' })
export class DepotInventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly pricing: PricingService,
  ) {}

  @Roles(...CAPABILITIES.inventoryWrite)
  @Post()
  @ApiOperation({ summary: 'Add a stock line to a depot (staff)' })
  create(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreateInventoryItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItemView> {
    return this.inventory.createLine(
      depotId,
      {
        itemType: dto.itemType,
        productId: dto.productId ?? null,
        label: dto.label,
        unit: dto.unit,
        quantity: dto.quantity ?? 0,
        minimumStock: dto.minimumStock ?? 0,
        sellPrice: dto.sellPrice ?? null,
      },
      user.sub,
    );
  }

  // Public price lookup for checkout (order-service). Declared before the ':...'
  // routes so the static 'prices' segment wins. Prices are customer-facing, so no
  // auth — like the public product catalog. productIds is a comma-separated list.
  @Public()
  @Get('prices')
  @ApiOperation({ summary: 'Per-depot resolved prices (override + active rule) for products (public)' })
  prices(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query('productIds') productIds?: string,
  ): Promise<ResolvedProductPrice[]> {
    const ids = (productIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.pricing.resolvePrices(depotId, ids);
  }

  @Roles(...CAPABILITIES.inventoryRead)
  @Get('movements')
  @ApiOperation({ summary: "List a depot's stock movements (paginated, newest first)" })
  movements(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: ListStockMovementsQueryDto,
  ): Promise<Page<DepotStockMovementRecord>> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException('from must be earlier than to');
    }
    return this.inventory.listMovementsForDepot(depotId, {
      type: query.type,
      from,
      to,
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    });
  }

  @Roles(...CAPABILITIES.inventoryRead)
  @Get()
  @ApiOperation({ summary: "List a depot's stock lines (staff)" })
  list(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query() query: ListInventoryQueryDto,
  ): Promise<ItemView[]> {
    return this.inventory.listForDepot(depotId, {
      itemType: query.itemType,
      lowStockOnly: query.lowStockOnly,
    });
  }

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('consume')
  @ApiOperation({ summary: 'Deduct sold quantities from PRODUK stock on order completion (internal service auth)' })
  consume(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ConsumeStockDto,
  ): Promise<{ orderId: string; depotId: string; consumed: string[]; skipped: string[] }> {
    return this.inventory.consumeForOrder(depotId, dto.orderId, dto.items, INVENTORY_ACTOR);
  }

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('reserve')
  @ApiOperation({ summary: 'Hold PRODUK stock for an order at checkout (internal service auth)' })
  reserve(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ConsumeStockDto,
  ): Promise<{ orderId: string; depotId: string; reserved: string[]; skipped: string[] }> {
    return this.inventory.reserveForOrder(depotId, dto.orderId, dto.items, INVENTORY_ACTOR);
  }

  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('release')
  @ApiOperation({ summary: "Release an order's PRODUK stock holds on cancellation (internal service auth)" })
  release(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ConsumeStockDto,
  ): Promise<{ orderId: string; depotId: string; released: string[] }> {
    return this.inventory.releaseForOrder(depotId, dto.orderId, dto.items);
  }
}

/** Operations on a single stock line by id. */
@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // Declared before ':itemId' so the static segment wins the route match.
  @Roles(...CAPABILITIES.inventoryRead)
  @Get('low-stock')
  @ApiOperation({ summary: 'List low-stock lines, optionally for one depot (FR-074)' })
  lowStock(@Query('depotId') depotId?: string): Promise<ItemView[]> {
    return this.inventory.listLowStock(depotId);
  }

  // Static segment: declared before ':itemId' so it wins the route match.
  @Roles(...CAPABILITIES.inventoryRead)
  @Get('wastage')
  @ApiOperation({ summary: 'Depot wastage summary from negative ADJUSTMENT movements' })
  wastage(@Query() q: WastageQueryDto): Promise<WastageSummary> {
    return this.inventory.wastageSummary(
      q.depotId,
      q.from ? new Date(q.from) : undefined,
      q.to ? new Date(q.to) : undefined,
    );
  }

  @Roles(...CAPABILITIES.inventoryRead)
  @Get(':itemId')
  @ApiOperation({ summary: 'Get a stock line by id (staff)' })
  get(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<ItemView> {
    return this.inventory.get(itemId);
  }

  @Roles(...CAPABILITIES.inventoryWrite)
  @Patch(':itemId')
  @ApiOperation({ summary: 'Update a stock line label/unit/minimum (staff)' })
  update(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateInventoryItemDto,
  ): Promise<ItemView> {
    return this.inventory.updateMeta(itemId, dto);
  }

  @Roles(...CAPABILITIES.inventoryWrite)
  @Post(':itemId/adjust')
  @ApiOperation({ summary: 'Adjust stock by a signed delta (FR-072, staff)' })
  adjust(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization: string,
  ): Promise<ItemView> {
    return this.inventory.adjust(itemId, dto.delta, dto.reason ?? null, user.sub, authorization);
  }

  @Roles(...CAPABILITIES.inventoryWrite)
  @Post(':itemId/opname')
  @ApiOperation({ summary: 'Reconcile stock to a physical count (FR-073, staff)' })
  opname(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: OpnameStockDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization: string,
  ): Promise<ItemView> {
    return this.inventory.opname(itemId, dto.countedQuantity, dto.reason ?? null, user.sub, authorization);
  }

  @Roles(...CAPABILITIES.inventoryRead)
  @Get(':itemId/movements')
  @ApiOperation({ summary: 'Stock movement history for a line (staff)' })
  movements(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<StockMovementRecord[]> {
    return this.inventory.movements(itemId);
  }
}
