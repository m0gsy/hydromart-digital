import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, CurrentUser, AuthenticatedUser } from '@hydromart/platform';

import { CashbookService, CashbookView } from '../application/services/cashbook.service';
import { CashbookEntry } from '../domain/cashbook';
import { CreateCashbookDto, ListCashbookQueryDto } from './dto/cashbook.dto';

/** Depot cashbook / daily cash-flow ledger (design 14c). */
@ApiTags('Cashbook')
@ApiBearerAuth()
@Can('depotFinance')
@Controller({ path: 'cashbook', version: '1' })
export class CashbookController {
  constructor(private readonly cashbook: CashbookService) {}

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
