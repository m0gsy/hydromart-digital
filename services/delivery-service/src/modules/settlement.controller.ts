import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  Can,
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import { SettlementService } from '../application/services/settlement.service';
import { SURPLUS_NOTE_THRESHOLD_IDR } from '../domain/settlement';
import { DepositedCod, SettlementRecord } from '../application/ports/settlement.repository';
import {
  DepositedCodQueryDto,
  DisputeSettlementDto,
  SettlementQueryDto,
  SettlementRulesDto,
  VerifySettlementDto,
} from './dto/settlement.dto';
import { DepositedCodResponseDto, SettlementResponseDto } from './dto/responses.generated.dto';

/** Cashier-facing COD settlement: verify or dispute a courier's deposit (design 6a). */
@ApiTags('Settlements')
@ApiBearerAuth()
@Can('courierSettle')
@Controller({ path: 'settlements', version: '1' })
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  /**
   * COD accepted at a depot in a window, for depot-service's daily close.
   *
   * Internal key rather than the cashier capability above: the caller is a machine closing
   * a day's books, not a person looking at a queue. Declared FIRST so the static `internal`
   * segment cannot be read as a settlement id.
   */
  @ApiOkResponse({ type: DepositedCodResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('internal/deposited')
  @ApiOperation({ summary: 'COD accepted at one depot in [from, to) (internal service auth)' })
  deposited(@Query() query: DepositedCodQueryDto): Promise<DepositedCod> {
    return this.settlements.depositedForDepot(
      query.depotId,
      new Date(query.from),
      new Date(query.to),
    );
  }

  /*
   * Declared before the list route and before any `:id`, and a static segment either way.
   * No service call: the rule is a constant, and routing it through the service would only
   * put a layer between the screen's sentence and the number that refuses the deposit.
   */
  @ApiOkResponse({ type: SettlementRulesDto })
  @Get('rules')
  @ApiOperation({ summary: 'Settlement rules a cashier screen states (C1)' })
  rules(): SettlementRulesDto {
    return { surplusNoteThresholdIdr: SURPLUS_NOTE_THRESHOLD_IDR };
  }

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
