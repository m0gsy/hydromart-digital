import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public } from '@hydromart/platform';

import { GallonLedgerPrismaRepository, GallonLedgerRow } from '../infrastructure/prisma/gallon-ledger.prisma.repository';
import { GallonLedgerQueryDto } from './dto/gallon-ledger.dto';

/**
 * HD-6 H3: the gallon ledger of many depots over one window, for the AI read API (dashboard-service).
 * Internal key only; counts and rupiah per depot, no customer.
 */
@ApiTags('Gallon network')
@Controller({ path: 'gallon-outstanding', version: '1' })
export class GallonLedgerController {
  constructor(private readonly ledger: GallonLedgerPrismaRepository) {}

  @ApiOkResponse({ description: '`{ items }`: one row per depot with any ledger row; a depot with none is absent.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/ledger-summary')
  @ApiOperation({ summary: 'Gallons out, returned and deposit for many depots, balance at `to` and the window (internal)' })
  async summary(@Query() q: GallonLedgerQueryDto): Promise<{ items: GallonLedgerRow[] }> {
    return { items: await this.ledger.ledger(q.depotIds.split(','), new Date(q.from), new Date(q.to)) };
  }
}
