import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  Can,
  CurrentUser,
  AuthenticatedUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { CashbookService, CashbookView } from '../application/services/cashbook.service';
import { DepotCosts, DepotCostsService } from '../application/services/depot-costs.service';
import { CashbookEntry } from '../domain/cashbook';
import { CreateCashbookDto, DepotCostsQueryDto, ListCashbookQueryDto } from './dto/cashbook.dto';
import {
  CashbookEntryResponseDto,
  CashbookResponseDto,
  DepotCostsResponseDto,
} from './dto/responses.generated.dto';

/** Depot cashbook / daily cash-flow ledger (design 14c). */
@ApiTags('Cashbook')
@ApiBearerAuth()
@Can('depotFinance')
@Controller({ path: 'cashbook', version: '1' })
export class CashbookController {
  constructor(
    private readonly cashbook: CashbookService,
    private readonly costs: DepotCostsService,
  ) {}

  /**
   * The cost side of one depot's month, for order-service's monthly review (S2). Internal
   * key rather than `depotFinance`: the caller is a service composing a P&L and holds no
   * token for this depot's staff. `@Public()` short-circuits RolesGuard so the class-level
   * @Can cannot 403 a request that is deliberately identity-less. Declared FIRST so the
   * static `internal` segment wins.
   */
  @ApiOkResponse({ type: DepotCostsResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/depot-costs')
  @ApiOperation({ summary: "One depot's goods + operating cost over a window (internal)" })
  depotCosts(@Query() query: DepotCostsQueryDto): Promise<DepotCosts> {
    return this.costs.costsInRange(query.depotId, new Date(query.from), new Date(query.to));
  }

  @ApiOkResponse({ type: CashbookResponseDto })
  @Get()
  @ApiOperation({
    summary: "List a depot's cashbook entries (newest first) with in/out/net summary",
  })
  list(@Query() query: ListCashbookQueryDto): Promise<CashbookView> {
    return this.cashbook.list(query.depotId, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @ApiOkResponse({ type: CashbookEntryResponseDto })
  @Post()
  @ApiOperation({ summary: 'Record a cashbook entry' })
  record(
    @Body() dto: CreateCashbookDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CashbookEntry> {
    return this.cashbook.record(
      {
        depotId: dto.depotId,
        direction: dto.direction,
        category: dto.category,
        label: dto.label,
        amountIdr: dto.amountIdr,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
      },
      user.sub,
    );
  }
}
