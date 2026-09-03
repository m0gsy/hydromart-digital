import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  Can,
  CurrentUser,
  addLocalDays,
  assertDepotAccess,
  dayStartUtc,
} from '@hydromart/platform';

import { PricingService } from '../application/services/pricing.service';
import { DepotConfigService } from '../config/depot-config.service';
import { PricingRuleRecord } from '../domain/pricing-rule';
import { UpdatePricingRuleData } from '../application/ports/pricing-rule.repository';
import { CreatePricingRuleDto, UpdatePricingRuleDto } from './dto/pricing-rule.dto';
import { PricingRuleResponseDto, RemoveResponseDto } from './dto/responses.generated.dto';

/**
 * CA-2-12: a promo's last day is a DAY, in Jakarta — not an instant in UTC.
 *
 * This was `new Date(v)`, and the pricing form sends a date input's `YYYY-MM-DD`.
 * `new Date('2026-12-31')` is midnight UTC, which is 07:00 in Jakarta — so a rule valid
 * "until 31 December" stopped applying at seven in the morning on the 31st, and one
 * starting on the 1st did not begin until seven that morning. Every depot ran its promos
 * seventeen hours short at one end and seven hours late at the other.
 *
 * The rest of `isRuleActive` was already zone-aware — the weekday and the time-of-day
 * window both go through `localParts(now, timeZone)`. Only the date window was compared
 * as a raw instant, which is what made this survive: the rule looked right on every day
 * except the two that bound it.
 *
 * A date-only string is read in the business zone: `validFrom` at the START of that day,
 * `validUntil` at the END of it, so "until 31 December" includes all of the 31st. A full
 * ISO instant is left alone — a caller that named a moment meant that moment.
 */
function toDate(v: string | undefined, edge: 'start' | 'end', timeZone: string): Date | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v);
  const start = dayStartUtc(v, timeZone);
  // The end of a day is the instant before the next one starts; `isRuleActive` compares
  // with `now > validUntil`, so the last millisecond of the day is still inside.
  return edge === 'start' ? start : new Date(addLocalDays(start, 1, timeZone).getTime() - 1);
}

@ApiTags('Pricing')
@ApiBearerAuth()
@Controller({ path: 'depots/:depotId/pricing', version: '1' })
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly config: DepotConfigService,
  ) {}

  @ApiOkResponse({ type: PricingRuleResponseDto })
  @Can('depotAdmin')
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
      validFrom: toDate(dto.validFrom, 'start', this.config.businessTimeZone),
      validUntil: toDate(dto.validUntil, 'end', this.config.businessTimeZone),
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
    });
  }

  @ApiOkResponse({ type: PricingRuleResponseDto, isArray: true })
  @Can('depotAdmin')
  @Get('rules')
  @ApiOperation({ summary: "List a depot's pricing rules (staff)" })
  list(@Param('depotId', ParseUUIDPipe) depotId: string): Promise<PricingRuleRecord[]> {
    return this.pricing.list(depotId);
  }

  @ApiOkResponse({ type: PricingRuleResponseDto })
  @Can('depotAdmin')
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
    if (dto.validFrom !== undefined)
      patch.validFrom = toDate(dto.validFrom, 'start', this.config.businessTimeZone);
    if (dto.validUntil !== undefined)
      patch.validUntil = toDate(dto.validUntil, 'end', this.config.businessTimeZone);
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.active !== undefined) patch.active = dto.active;
    return this.pricing.update(ruleId, patch);
  }

  @ApiOkResponse({ type: RemoveResponseDto })
  @Can('depotAdmin')
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
