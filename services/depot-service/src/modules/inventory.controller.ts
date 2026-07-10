import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, AuthenticatedUser, Role, Roles } from '@hydromart/platform';

import { InventoryService, ItemView } from '../application/services/inventory.service';
import { StockMovementRecord } from '../application/ports/inventory.repository';
import {
  AdjustStockDto,
  ConsumeStockDto,
  CreateInventoryItemDto,
  ListInventoryQueryDto,
  OpnameStockDto,
  UpdateInventoryItemDto,
} from './dto/inventory.dto';

const INVENTORY_WRITE_ROLES = [Role.DEPOT_OPERATOR, Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;
// Stock consumption is triggered by order completion, which a driver can perform,
// so the forwarded completing-staff token may be a DRIVER.
const INVENTORY_CONSUME_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.DRIVER,
  Role.SUPER_ADMIN,
] as const;
const INVENTORY_READ_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.HEAD_OFFICE,
  Role.SUPER_ADMIN,
] as const;

/** Stock lines nested under a depot (create + list). */
@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/inventory', version: '1' })
export class DepotInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Roles(...INVENTORY_WRITE_ROLES)
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
      },
      user.sub,
    );
  }

  @Roles(...INVENTORY_READ_ROLES)
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

  @Roles(...INVENTORY_CONSUME_ROLES)
  @Post('consume')
  @ApiOperation({ summary: 'Deduct sold quantities from PRODUK stock on order completion' })
  consume(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: ConsumeStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ orderId: string; depotId: string; consumed: string[]; skipped: string[] }> {
    return this.inventory.consumeForOrder(depotId, dto.orderId, dto.items, user.sub);
  }
}

/** Operations on a single stock line by id. */
@ApiTags('Inventory')
@ApiBearerAuth()
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // Declared before ':itemId' so the static segment wins the route match.
  @Roles(...INVENTORY_READ_ROLES)
  @Get('low-stock')
  @ApiOperation({ summary: 'List low-stock lines, optionally for one depot (FR-074)' })
  lowStock(@Query('depotId') depotId?: string): Promise<ItemView[]> {
    return this.inventory.listLowStock(depotId);
  }

  @Roles(...INVENTORY_READ_ROLES)
  @Get(':itemId')
  @ApiOperation({ summary: 'Get a stock line by id (staff)' })
  get(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<ItemView> {
    return this.inventory.get(itemId);
  }

  @Roles(...INVENTORY_WRITE_ROLES)
  @Patch(':itemId')
  @ApiOperation({ summary: 'Update a stock line label/unit/minimum (staff)' })
  update(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateInventoryItemDto,
  ): Promise<ItemView> {
    return this.inventory.updateMeta(itemId, dto);
  }

  @Roles(...INVENTORY_WRITE_ROLES)
  @Post(':itemId/adjust')
  @ApiOperation({ summary: 'Adjust stock by a signed delta (FR-072, staff)' })
  adjust(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItemView> {
    return this.inventory.adjust(itemId, dto.delta, dto.reason ?? null, user.sub);
  }

  @Roles(...INVENTORY_WRITE_ROLES)
  @Post(':itemId/opname')
  @ApiOperation({ summary: 'Reconcile stock to a physical count (FR-073, staff)' })
  opname(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: OpnameStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItemView> {
    return this.inventory.opname(itemId, dto.countedQuantity, dto.reason ?? null, user.sub);
  }

  @Roles(...INVENTORY_READ_ROLES)
  @Get(':itemId/movements')
  @ApiOperation({ summary: 'Stock movement history for a line (staff)' })
  movements(@Param('itemId', ParseUUIDPipe) itemId: string): Promise<StockMovementRecord[]> {
    return this.inventory.movements(itemId);
  }
}
