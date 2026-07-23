import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { CourierPayoutService } from '../application/services/courier-payout.service';
import { CourierEarningRuleRecord } from '../application/ports/courier-ledger.repository';
import { ApplyEarningRuleDto } from './dto/earning-rule.dto';

/**
 * Courier earning-rule editor (design 6b). Finance-owned config, gated on the roles
 * directly (like commission schemes, not the per-depot capability matrix). Rules are
 * append-only + effective-dated so historical pay stays reproducible.
 */
@ApiTags('Courier Earning Rules')
@ApiBearerAuth()
@Roles(Role.FINANCE, Role.SUPER_ADMIN)
@Controller({ path: 'courier-earning-rules', version: '1' })
export class EarningRuleController {
  constructor(private readonly payout: CourierPayoutService) {}

  @Get()
  @ApiOperation({ summary: 'List every earning rule (network default + per-depot), newest first' })
  list(): Promise<CourierEarningRuleRecord[]> {
    return this.payout.listEarningRules();
  }

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
