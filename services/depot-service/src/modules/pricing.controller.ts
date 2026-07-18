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

import { CurrentUser, AuthenticatedUser, Roles, assertDepotAccess } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { PricingService } from '../application/services/pricing.service';
import { PricingRuleRecord } from '../domain/pricing-rule';
import { UpdatePricingRuleData } from '../application/ports/pricing-rule.repository';
import { CreatePricingRuleDto, UpdatePricingRuleDto } from './dto/pricing-rule.dto';

function toDate(v?: string): Date | null {
  return v ? new Date(v) : null;
}

@ApiTags('Pricing')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/pricing', version: '1' })
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Roles(...CAPABILITIES.depotAdmin)
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

  @Roles(...CAPABILITIES.depotAdmin)
  @Get('rules')
  @ApiOperation({ summary: "List a depot's pricing rules (staff)" })
  list(@Param('depotId', ParseUUIDPipe) depotId: string): Promise<PricingRuleRecord[]> {
    return this.pricing.list(depotId);
  }

  @Roles(...CAPABILITIES.depotAdmin)
  @Patch('rules/:ruleId')
  @ApiOperation({ summary: 'Update a pricing rule (staff)' })
  async update(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdatePricingRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PricingRuleRecord> {
    assertDepotAccess(user, (await this.pricing.get(ruleId)).depotId);
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

  @Roles(...CAPABILITIES.depotAdmin)
  @Delete('rules/:ruleId')
  @ApiOperation({ summary: 'Delete a pricing rule (staff)' })
  async remove(
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    assertDepotAccess(user, (await this.pricing.get(ruleId)).depotId);
    await this.pricing.remove(ruleId);
    return { deleted: true };
  }
}
