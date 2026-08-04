import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { SettlementService } from '../application/services/settlement.service';
import { SettlementRecord } from '../application/ports/settlement.repository';
import { DisputeSettlementDto, SettlementQueryDto, VerifySettlementDto } from './dto/settlement.dto';
import { SettlementResponseDto } from './dto/responses.generated.dto';

/** Cashier-facing COD settlement: verify or dispute a courier's deposit (design 6a). */
@ApiTags('Settlements')
@ApiBearerAuth()
@Can('courierSettle')
@Controller({ path: 'settlements', version: '1' })
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @ApiOkResponse({ type: SettlementResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: "A depot's courier settlements, newest first (cashier)" })
  list(@Query() query: SettlementQueryDto): Promise<SettlementRecord[]> {
    return this.settlements.searchForDepot(query.depotId, query.status);
  }

  @ApiOkResponse({ type: SettlementResponseDto })
  @Post(':id/verify')
  @ApiOperation({ summary: 'Accept a courier deposit; optionally charge a shortfall' })
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifySettlementDto,
  ): Promise<SettlementRecord> {
    return this.settlements.verify(user, id, dto);
  }

  @ApiOkResponse({ type: SettlementResponseDto })
  @Post(':id/dispute')
  @ApiOperation({ summary: 'Dispute a courier deposit (parks it for resolution)' })
  dispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisputeSettlementDto,
  ): Promise<SettlementRecord> {
    return this.settlements.dispute(user, id, dto.note);
  }
}
