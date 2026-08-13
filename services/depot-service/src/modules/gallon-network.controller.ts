import { Controller, Get, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  Can,
  CurrentUser,
  AuthenticatedUser,
  InternalAuthGuard,
  Public,
  Role,
} from '@hydromart/platform';

import { DepotService } from '../application/services/depot.service';
import {
  CustomerGallonLedgerEntry,
  CustomerGallonRow,
  GallonNetworkService,
  GallonOutstandingRow,
} from '../application/services/gallon-network.service';
import {
  CustomerGallonLedgerEntryResponseDto,
  CustomerGallonRowResponseDto,
  GallonOutstandingRowResponseDto,
  GallonReturnRangeResponseDto,
} from './dto/responses.generated.dto';
import { GallonReturnRangeQueryDto } from './dto/gallon-return.dto';
import { GallonReturnRangeSummary } from '../application/ports/gallon-return.repository';

/**
 * Network gallon rollup (HQ compare 14d + reconciliation 22a). Distinct static path so
 * it never collides with the depot `:id` routes. Read-only, HQ ops read roles.
 */
@ApiTags('Gallon network')
@ApiBearerAuth()
@Controller({ path: 'gallon-outstanding', version: '1' })
export class GallonNetworkController {
  constructor(
    private readonly gallon: GallonNetworkService,
    private readonly depots: DepotService,
  ) {}

  /**
   * J-2: the two columns the depot customer directory rendered as a hardcoded null —
   * gallons on loan and deposit held, per customer. customer-service asks for one depot at
   * a time and merges by customer id.
   *
   * Internal key, not the cashier capability: the caller is customer-service assembling a
   * screen, and it holds no user token for the depot in question. Declared FIRST so the
   * static `internal` segment cannot be read as anything else.
   */
  @ApiOkResponse({ type: CustomerGallonRowResponseDto, isArray: true })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/by-customer')
  @ApiOperation({ summary: "One depot's outstanding empties + deposit per customer (internal)" })
  perCustomer(@Query('depotId', ParseUUIDPipe) depotId: string): Promise<CustomerGallonRow[]> {
    return this.gallon.perCustomer(depotId);
  }

  /**
   * The same customer's movements behind those two numbers — the CRM detail deposit
   * ledger. Internal key for the same reason as `by-customer` above.
   */
  @ApiOkResponse({ type: CustomerGallonLedgerEntryResponseDto, isArray: true })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/customer-ledger')
  @ApiOperation({ summary: "One customer's gallon deposit movements at one depot (internal)" })
  customerLedger(
    @Query('depotId', ParseUUIDPipe) depotId: string,
    @Query('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<CustomerGallonLedgerEntry[]> {
    return this.gallon.customerLedger(depotId, customerId);
  }

  /**
   * Gallons handed back at one depot on one day, for order-service's daily report — the
   * `gallonsReturned`/`gallonsDamaged` columns that used to be hardcoded null (S2).
   *
   * Internal key for the same reason as the two routes above: the caller is a service
   * composing a report, holding no token for this depot's staff.
   */
  @ApiOkResponse({ type: GallonReturnRangeResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/returns-range')
  @ApiOperation({ summary: "Gallons returned at one depot over a window (internal)" })
  returnsInRange(@Query() query: GallonReturnRangeQueryDto): Promise<GallonReturnRangeSummary> {
    return this.gallon.gallonsInRange(query.depotId, new Date(query.from), new Date(query.to));
  }

  @ApiOkResponse({ type: GallonOutstandingRowResponseDto, isArray: true })
  @Can('returnsRead')
  @Get()
  @ApiOperation({ summary: 'Per-depot outstanding empties + net deposit held (network)' })
  async outstanding(@CurrentUser() user: AuthenticatedUser): Promise<GallonOutstandingRow[]> {
    const rows = await this.gallon.outstanding();
    // A franchise owner sees only depots they own, never the whole network (returnsRead is
    // shared with HQ). Everyone else on the cap keeps the full network rollup.
    if (user.role === Role.FRANCHISE_OWNER) {
      const owned = new Set((await this.depots.listMine(user.sub)).map((d) => d.id));
      return rows.filter((r) => owned.has(r.depotId));
    }
    return rows;
  }
}
