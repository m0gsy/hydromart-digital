import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser, InternalAuthGuard, Public, ImportSummary } from '@hydromart/platform';

import {
  InventoryService,
  ItemView,
  WastageSummary,
} from '../application/services/inventory.service';
import { Page } from '../application/pagination';
import { PricingService, ResolvedProductPrice } from '../application/services/pricing.service';
import {
  DepotStockMovementRecord,
  ReservationRecord,
  StockMovementRecord,
} from '../application/ports/inventory.repository';
import {
  AdjustStockDto,
  ConsumeStockDto,
  ImportInventoryDto,
  CreateInventoryItemDto,
  ListInventoryQueryDto,
  ListStockMovementsQueryDto,
  OpnameStockDto,
  ProductChangedDto,
  UpdateInventoryItemDto,
  WastageQueryDto,
} from './dto/inventory.dto';
import { ConsumeResponseDto, ImportResponseDto, ItemResponseDto, PagedDepotStockMovementResponseDto, ProductChangedResponseDto, ReleaseResponseDto, ReservationResponseDto, ReserveResponseDto, ResolvedProductPriceResponseDto, RestockResponseDto, StockMovementResponseDto, WastageResponseDto } from './dto/responses.generated.dto';

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

  @ApiOkResponse({ type: ItemResponseDto })
  @Can('inventoryWrite')
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
        sku: dto.sku ?? null,
        label: dto.label,
        unit: dto.unit,
        quantity: dto.quantity ?? 0,
        minimumStock: dto.minimumStock ?? 0,
        sellPrice: dto.sellPrice ?? null,
      },
      user.sub,
    );
  }

  @ApiOkResponse({ type: ImportResponseDto })
  @Can('inventoryWrite')
  @Post('import')
  @ApiOperation({ summary: 'Bulk-create stock lines from the CSV wizard (staff)' })
  import(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ImportInventoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImportSummary> {
    return this.inventory.importLines(
      depotId,
      dto.rows.map((row) => ({
        itemType: row.itemType,
        productId: row.productId ?? null,
        sku: row.sku ?? null,
        label: row.label,
        unit: row.unit,
        quantity: row.quantity ?? 0,
        minimumStock: row.minimumStock ?? 0,
        sellPrice: row.sellPrice ?? null,
      })),
      user.sub,
    );
  }

  // Public price lookup for checkout (order-service). Declared before the ':...'
  // routes so the static 'prices' segment wins. Prices are customer-facing, so no
  // auth — like the public product catalog. productIds is a comma-separated list.
  @ApiOkResponse({ type: ResolvedProductPriceResponseDto, isArray: true })
  @Public()
  @Get('prices')
  @ApiOperation({
    summary: 'Per-depot resolved prices (override + active rule) for products (public)',
  })
  prices(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Query('productIds') productIds?: string,
    @Query('quantities') quantities?: string,
  ): Promise<ResolvedProductPrice[]> {
    const ids = (productIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Positional against productIds. Supplying it opts the caller into wholesale bands
    // (design 16b); junk or missing entries resolve to 0, i.e. "no band for this line".
    const qty = (quantities ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .map((n) => (Number.isFinite(n) && n > 0 ? n : 0));
    return this.pricing.resolvePrices(depotId, ids, new Date(), qty);
  }

  @ApiOkResponse({ type: PagedDepotStockMovementResponseDto })
  @Can('inventoryRead')
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

  @ApiOkResponse({ type: ItemResponseDto, isArray: true })
  @Can('inventoryRead')
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

  @ApiOkResponse({ type: ConsumeResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('consume')
  @ApiOperation({
    summary: 'Deduct sold quantities from PRODUK stock on order completion (internal service auth)',
  })
  consume(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ConsumeStockDto,
  ): Promise<{ orderId: string; depotId: string; consumed: string[]; skipped: string[] }> {
    return this.inventory.consumeForOrder(depotId, dto.orderId, dto.items, INVENTORY_ACTOR);
  }

  @ApiOkResponse({ type: ReserveResponseDto })
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

  @ApiOkResponse({ type: RestockResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('restock')
  @ApiOperation({
    summary: 'Put back stock a voided counter sale had taken out (internal service auth)',
  })
  restock(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ConsumeStockDto,
  ): Promise<{ orderId: string; depotId: string; restocked: string[]; skipped: string[] }> {
    return this.inventory.restockForOrder(depotId, dto.orderId, dto.items, INVENTORY_ACTOR);
  }

  @ApiOkResponse({ type: ReleaseResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('release')
  @ApiOperation({
    summary: "Release an order's PRODUK stock holds on cancellation (internal service auth)",
  })
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

  // Pushed by product-service when a product is renamed or switched off, so the lines
  // that copied its name do not keep showing the old one. Declared before ':itemId' so
  // the static segment wins the route match.
  @ApiOkResponse({ type: ProductChangedResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/product-changed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply a catalog rename/deactivation to every depot line for that product (internal)',
  })
  productChanged(
    @Body() dto: ProductChangedDto,
  ): Promise<{ renamed: number; hidden: number }> {
    return this.inventory.applyProductChange(dto);
  }

  // Declared before ':itemId' so the static segment wins the route match.
  @ApiOkResponse({ type: ItemResponseDto, isArray: true })
  @Can('inventoryRead')
  @Get('low-stock')
  @ApiOperation({ summary: 'List low-stock lines, optionally for one depot (FR-074)' })
  lowStock(
    @Query('depotId') depotId?: string,
    @Query('depotIds') depotIds?: string,
  ): Promise<ItemView[]> {
    // `depotIds` (comma-separated) is the batch form the owner dashboard uses — one call
    // for every depot it owns instead of one per depot (audit S-1). `depotId` stays for
    // the single-depot console.
    const many = (depotIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.inventory.listLowStock(many.length > 0 ? many : depotId);
  }

  // Static segment: declared before ':itemId' so it wins the route match.
  @ApiOkResponse({ type: WastageResponseDto })
  @Can('inventoryRead')
  @Get('wastage')
  @ApiOperation({ summary: 'Depot wastage summary from negative ADJUSTMENT movements' })
  wastage(@Query() q: WastageQueryDto): Promise<WastageSummary> {
    return this.inventory.wastageSummary(
      q.depotId,
      q.from ? new Date(q.from) : undefined,
      q.to ? new Date(q.to) : undefined,
    );
  }

  @ApiOkResponse({ type: ReservationResponseDto, isArray: true })
  @Can('inventoryRead')
  @Get(':itemId/reservations')
  @ApiOperation({ summary: 'Active order holds on one stock line (what "dipesan" is)' })
  reservations(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<ReservationRecord[]> {
    return this.inventory.listReservations(itemId);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Can('inventoryWrite')
  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an empty stock line that never sold anything (staff)',
  })
  remove(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<void> {
    return this.inventory.deleteLine(itemId);
  }

  @ApiOkResponse({ type: ItemResponseDto })
  @Can('inventoryRead')
  @Get(':itemId')
  @ApiOperation({ summary: 'Get a stock line by id (staff)' })
  get(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<ItemView> {
    return this.inventory.get(itemId);
  }

  @ApiOkResponse({ type: ItemResponseDto })
  @Can('inventoryWrite')
  @Patch(':itemId')
  @ApiOperation({ summary: 'Update a stock line label/unit/minimum (staff)' })
  update(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateInventoryItemDto,
  ): Promise<ItemView> {
    return this.inventory.updateMeta(itemId, dto);
  }

  @ApiOkResponse({ type: ItemResponseDto })
  @Can('inventoryWrite')
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

  @ApiOkResponse({ type: ItemResponseDto })
  @Can('inventoryWrite')
  @Post(':itemId/opname')
  @ApiOperation({ summary: 'Reconcile stock to a physical count (FR-073, staff)' })
  opname(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: OpnameStockDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization: string,
  ): Promise<ItemView> {
    return this.inventory.opname(
      itemId,
      dto.countedQuantity,
      dto.reason ?? null,
      user.sub,
      authorization,
    );
  }

  @ApiOkResponse({ type: StockMovementResponseDto, isArray: true })
  @Can('inventoryRead')
  @Get(':itemId/movements')
  @ApiOperation({ summary: 'Stock movement history for a line (staff)' })
  movements(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<StockMovementRecord[]> {
    return this.inventory.movements(itemId);
  }
}
