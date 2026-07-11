import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Role, Roles } from '@hydromart/platform';

import { PricingService } from '../application/services/pricing.service';
import { PricingRuleRecord } from '../domain/pricing-rule';
import { UpdatePricingRuleData } from '../application/ports/pricing-rule.repository';
import { CreatePricingRuleDto, UpdatePricingRuleDto } from './dto/pricing-rule.dto';

const PRICING_ADMIN_ROLES = [Role.DEPOT_MANAGER, Role.SUPER_ADMIN] as const;

function toDate(v?: string): Date | null {
  return v ? new Date(v) : null;
}

@ApiTags('Pricing')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/pricing', version: '1' })
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Roles(...PRICING_ADMIN_ROLES)
  @Post('rules')
  @ApiOperation({ summary: 'Create a dynamic pricing rule for a depot (staff)' })
  create(
    @Param('depotId', ParseUUIDPipe) depotId: string,
    @Body() dto: CreatePricingRuleDto,
  ): Promise<PricingRuleRecord> {
    return this.pricing.create(depotId, {
      productId: dto.productId ?? null,
      adjustType: dto.adjustType,
      value: dto.value,
      daysOfWeek: dto.daysOfWeek ?? [],
      startMinute: dto.startMinute ?? null,
      endMinute: dto.endMinute ?? null,
      validFrom: toDate(dto.validFrom),
      validUntil: toDate(dto.validUntil),
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
    });
  }

  @Roles(...PRICING_ADMIN_ROLES)
  @Get('rules')
  @ApiOperation({ summary: "List a depot's pricing rules (staff)" })
  list(@Param('depotId', ParseUUIDPipe) depotId: string): Promise<PricingRuleRecord[]> {
    return this.pricing.list(depotId);
  }

  @Roles(...PRICING_ADMIN_ROLES)
  @Patch('rules/:ruleId')
  @ApiOperation({ summary: 'Update a pricing rule (staff)' })
  update(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdatePricingRuleDto,
  ): Promise<PricingRuleRecord> {
    const patch: UpdatePricingRuleData = {};
    if (dto.productId !== undefined) patch.productId = dto.productId ?? null;
    if (dto.adjustType !== undefined) patch.adjustType = dto.adjustType;
    if (dto.value !== undefined) patch.value = dto.value;
    if (dto.daysOfWeek !== undefined) patch.daysOfWeek = dto.daysOfWeek;
    if (dto.startMinute !== undefined) patch.startMinute = dto.startMinute;
    if (dto.endMinute !== undefined) patch.endMinute = dto.endMinute;
    if (dto.validFrom !== undefined) patch.validFrom = toDate(dto.validFrom);
    if (dto.validUntil !== undefined) patch.validUntil = toDate(dto.validUntil);
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.active !== undefined) patch.active = dto.active;
    return this.pricing.update(ruleId, patch);
  }

  @Roles(...PRICING_ADMIN_ROLES)
  @Delete('rules/:ruleId')
  @ApiOperation({ summary: 'Delete a pricing rule (staff)' })
  async remove(@Param('ruleId', ParseUUIDPipe) ruleId: string): Promise<{ deleted: boolean }> {
    await this.pricing.remove(ruleId);
    return { deleted: true };
  }
}
