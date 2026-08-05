import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can } from '@hydromart/platform';

import { CourierPayoutService } from '../application/services/courier-payout.service';
import { CourierEarningRuleRecord } from '../application/ports/courier-ledger.repository';
import { ApplyEarningRuleDto } from './dto/earning-rule.dto';
import { CourierEarningRuleResponseDto } from './dto/responses.generated.dto';

/**
 * Courier earning-rule editor (design 6b). Finance-owned config, gated on the roles
 * directly (like commission schemes, not the per-depot capability matrix). Rules are
 * append-only + effective-dated so historical pay stays reproducible.
 */
@ApiTags('Courier Earning Rules')
@ApiBearerAuth()
@Can('earningRules')
@Controller({ path: 'courier-earning-rules', version: '1' })
export class EarningRuleController {
  constructor(private readonly payout: CourierPayoutService) {}

  @ApiOkResponse({ type: CourierEarningRuleResponseDto, isArray: true })
  @Get()
  @ApiOperation({ summary: 'List every earning rule (network default + per-depot), newest first' })
  list(): Promise<CourierEarningRuleRecord[]> {
    return this.payout.listEarningRules();
  }

  @ApiOkResponse({ type: CourierEarningRuleResponseDto })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Apply a new effective-dated earning rule' })
  apply(@Body() dto: ApplyEarningRuleDto): Promise<CourierEarningRuleRecord> {
    return this.payout.applyEarningRule({
      depotId: dto.depotId ?? null,
      baseFare: dto.baseFare,
      peakBonus: dto.peakBonus,
      onTimeBonus: dto.onTimeBonus,
      peakStartHour: dto.peakStartHour,
      peakEndHour: dto.peakEndHour,
      monthlyTarget: dto.monthlyTarget ?? 0,
      tiers: dto.tiers ?? [],
      effectiveDate: new Date(dto.effectiveDate),
    });
  }
}
