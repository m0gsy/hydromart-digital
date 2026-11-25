import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { AiStockService, LossRow, OpenPurchaseRow, StockPositionRow } from '../application/services/ai-stock.service';
import { AiStockDepotsQueryDto, AiStockWindowQueryDto } from './dto/ai-stock.dto';

/**
 * HD-6 H4: the stock facts the AI read API reads (dashboard-service, internal key). The caller has
 * already narrowed the depot list to what the asker may read; these routes answer for exactly the
 * depots and instants they are given.
 */
@ApiTags('AI read sources')
@Controller({ path: 'internal/ai-stock', version: '1' })
export class AiStockController {
  constructor(private readonly stock: AiStockService) {}

  @ApiOkResponse({ description: '`{ items: StockPositionRow[] }`; a depot with no visible line is absent.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('position')
  @ApiOperation({ summary: 'Available stock and low-stock lines now, hidden lines left out (internal service auth)' })
  async position(@Query() q: AiStockDepotsQueryDto): Promise<{ items: StockPositionRow[] }> {
    return { items: await this.stock.stockPosition(q.depotIds.split(',')) };
  }

  @ApiOkResponse({ description: '`{ items: LossRow[] }`: units and purchase-price value per depot and item type.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('wastage')
  @ApiOperation({ summary: 'Broken or lost stock in a window, without lent gallons (internal service auth)' })
  async wastage(@Query() q: AiStockWindowQueryDto): Promise<{ items: LossRow[] }> {
    return { items: await this.stock.wastage(q.depotIds.split(','), new Date(q.from), new Date(q.to)) };
  }

  @ApiOkResponse({ description: '`{ items: LossRow[] }`: signed counted-minus-system units and value, rejected counts left out.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('opname')
  @ApiOperation({ summary: 'Stock count differences in a window at the last purchase price (internal service auth)' })
  async opname(@Query() q: AiStockWindowQueryDto): Promise<{ items: LossRow[] }> {
    return { items: await this.stock.opname(q.depotIds.split(','), new Date(q.from), new Date(q.to)) };
  }

  @ApiOkResponse({ description: '`{ items: OpenPurchaseRow[] }`: sent purchase orders not yet fully received.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('open-purchases')
  @ApiOperation({ summary: 'Value of goods still expected on sent purchase orders (internal service auth)' })
  async openPurchases(@Query() q: AiStockDepotsQueryDto): Promise<{ items: OpenPurchaseRow[] }> {
    return { items: await this.stock.openPurchases(q.depotIds.split(',')) };
  }
}
