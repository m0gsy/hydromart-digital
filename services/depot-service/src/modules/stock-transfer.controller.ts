import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser } from '@hydromart/platform';

import { StockTransferService } from '../application/services/stock-transfer.service';
import { StockTransferRecord } from '../application/ports/stock-transfer.repository';
import {
  CancelTransferDto,
  ListTransfersDto,
  SendTransferDto,
} from './dto/stock-transfer.dto';
import { StockTransferResponseDto } from './dto/responses.generated.dto';

/**
 * CA-2-54 — stock moving between two depots.
 *
 * `inventoryWrite` throughout, the same capability that adjusts and counts stock: a
 * transfer IS a stock movement, twice. Each route is scoped inside the service to the depot
 * whose stock it touches — the sender for `send` and `cancel`, the receiver for `receive` —
 * so a depot operator can give away and take in only their own.
 */
@ApiTags('Depot Stock Transfers')
@ApiBearerAuth()
@Controller({ path: 'stock-transfers', version: '1' })
export class StockTransferController {
  constructor(private readonly transfers: StockTransferService) {}

  @ApiOkResponse({ type: StockTransferResponseDto, isArray: true })
  @Get()
  @Can('inventoryRead')
  @ApiOperation({ summary: 'Transfers arriving at, or sent from, one depot' })
  list(
    @Query() query: ListTransfersDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StockTransferRecord[]> {
    return this.transfers.list(user, query.depotId, query.direction, query.status, query.limit);
  }

  @ApiOkResponse({ type: StockTransferResponseDto })
  @Post()
  @Can('inventoryWrite')
  @ApiOperation({ summary: 'Send stock to another depot (deducts here immediately)' })
  send(
    @Body() dto: SendTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StockTransferRecord> {
    return this.transfers.send(user, user.sub, dto);
  }

  @ApiOkResponse({ type: StockTransferResponseDto })
  @Post(':id/receive')
  @Can('inventoryWrite')
  @ApiOperation({ summary: 'Confirm a transfer arrived (credits this depot)' })
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StockTransferRecord> {
    return this.transfers.receive(user, user.sub, id);
  }

  @ApiOkResponse({ type: StockTransferResponseDto })
  @Post(':id/cancel')
  @Can('inventoryWrite')
  @ApiOperation({ summary: 'It never arrived: put the stock back at the sending depot' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StockTransferRecord> {
    return this.transfers.cancel(user, user.sub, id, dto.reason);
  }
}
