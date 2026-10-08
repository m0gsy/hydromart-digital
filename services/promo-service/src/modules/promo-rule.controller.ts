import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  AuthenticatedUser,
  Can,
  CurrentUser,
  InternalAuthGuard,
  Public,
  assertDepotAccess,
  depotScopeIds,
} from '@hydromart/platform';

import { PromoRuleRecord } from '../application/ports/promo-rule.repository';
import { PromoRuleService, QuoteOutput } from '../application/services/promo-rule.service';
import {
  AutoApplyApplyDto,
  AutoApplyQuoteDto,
  CreatePromoRuleDto,
  SimulatePromoRulesDto,
  UpdatePromoRuleDto,
} from './dto/promo-rule.dto';
import {
  AutoApplyQuoteResponseDto,
  PromoRuleResponseDto,
  PromoRuleUsageResponseDto,
} from './dto/responses.generated.dto';

const toDate = (iso?: string): Date | undefined => (iso ? new Date(iso) : undefined);

const toQuoteLines = (dto: AutoApplyQuoteDto) =>
  dto.lines.map((l) => ({
    productId: l.productId,
    categoryId: l.categoryId ?? null,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    skipPromo: l.skipPromo === true,
  }));

const toQuoteResponse = (result: QuoteOutput): AutoApplyQuoteResponseDto => ({
  lines: result.lines,
  shippingAppliedRuleId: result.shipping.appliedRuleId,
  shippingFeeOverride: result.shipping.shippingFeeOverride,
  orderDiscountRuleId: result.orderDiscount.appliedRuleId,
  orderDiscountAmount: result.orderDiscount.amount,
  gifts: result.gifts,
});

@ApiTags('Promo Rules')
@Controller({ path: 'promotions', version: '1' })
export class PromoRuleController {
  constructor(private readonly promoRules: PromoRuleService) {}

  @ApiOkResponse({ type: PromoRuleResponseDto, isArray: true })
  @ApiBearerAuth()
  @Can('promoRuleRead')
  @Get('promo-rules')
  @ApiOperation({ summary: 'List promo rules visible to the caller (admin)' })
  list(@CurrentUser() user?: AuthenticatedUser): Promise<PromoRuleRecord[]> {
    return this.promoRules.findAll(depotScopeIds(user));
  }

  // Declared BEFORE `promo-rules/:id`, or "usage" would be read as an id and refused by the
  // UUID pipe.
  @ApiOkResponse({ type: PromoRuleUsageResponseDto, isArray: true })
  @ApiBearerAuth()
  @Can('promoRuleRead')
  @Get('promo-rules/usage')
  @ApiOperation({ summary: 'How often each visible promo rule has fired (admin)' })
  async usage(@CurrentUser() user?: AuthenticatedUser): Promise<PromoRuleUsageResponseDto[]> {
    const rows = await this.promoRules.usage(depotScopeIds(user));
    return rows.map((r) => ({
      promoRuleId: r.promoRuleId,
      orders: r.orders,
      totalDiscount: r.totalDiscount,
      lastAppliedAt: r.lastAppliedAt ? r.lastAppliedAt.toISOString() : null,
    }));
  }

  @ApiOkResponse({ type: AutoApplyQuoteResponseDto })
  @ApiBearerAuth()
  @Can('promoRuleRead')
  @Post('promo-rules/simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Try a basket against the active rules, recording nothing (admin)' })
  async simulate(
    @Body() dto: SimulatePromoRulesDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<AutoApplyQuoteResponseDto> {
    // A depot-scoped reader may only try their own depot (and must name it).
    assertDepotAccess(user, dto.depotId ?? null);
    const result = await this.promoRules.quote({
      depotId: dto.depotId ?? null,
      channel: dto.channel,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      lines: toQuoteLines(dto),
      firstOrder: dto.firstOrder === true,
    });
    return toQuoteResponse(result);
  }

  @ApiOkResponse({ type: PromoRuleResponseDto })
  @ApiBearerAuth()
  @Can('promoRuleRead')
  @Get('promo-rules/:id')
  @ApiOperation({ summary: 'Read one promo rule (admin)' })
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<PromoRuleRecord> {
    const row = await this.promoRules.findById(id);
    // A network-wide rule (depotId null) is already visible to every depot-scoped reader via
    // list() — gating get() on it too would let list() show a rule the detail page then
    // refuses to open.
    if (row.depotId !== null) assertDepotAccess(user, row.depotId);
    return row;
  }

  @ApiOkResponse({ type: PromoRuleResponseDto })
  @ApiBearerAuth()
  @Can('promoRuleWrite')
  @Post('promo-rules')
  @ApiOperation({ summary: 'Create a promo rule (admin)' })
  create(
    @Body() dto: CreatePromoRuleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<PromoRuleRecord> {
    assertDepotAccess(user, dto.depotId ?? null);
    return this.promoRules.create({
      name: dto.name,
      kind: dto.kind,
      depotId: dto.depotId ?? null,
      productId: dto.productId ?? null,
      categoryId: dto.categoryId ?? null,
      specialPrice: dto.specialPrice ?? null,
      buyQty: dto.buyQty ?? null,
      getQty: dto.getQty ?? null,
      shippingFeeOverride: dto.shippingFeeOverride ?? null,
      percentOff: dto.percentOff ?? null,
      minSubtotal: dto.minSubtotal ?? null,
      discountAmount: dto.discountAmount ?? null,
      giftProductId: dto.giftProductId ?? null,
      firstOrderOnly: dto.firstOrderOnly ?? false,
      validFrom: toDate(dto.validFrom) ?? null,
      validUntil: toDate(dto.validUntil) ?? null,
      daysOfWeek: dto.daysOfWeek ?? [],
      startTime: dto.startTime ?? null,
      endTime: dto.endTime ?? null,
      minQty: dto.minQty ?? 1,
      maxQty: dto.maxQty ?? null,
      channels: dto.channels ?? [],
    });
  }

  @ApiOkResponse({ type: PromoRuleResponseDto })
  @ApiBearerAuth()
  @Can('promoRuleWrite')
  @Patch('promo-rules/:id')
  @ApiOperation({ summary: 'Update a promo rule (admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromoRuleDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<PromoRuleRecord> {
    const current = await this.promoRules.findById(id);
    assertDepotAccess(user, current.depotId);
    if (dto.depotId !== undefined) assertDepotAccess(user, dto.depotId ?? null);
    return this.promoRules.update(id, {
      name: dto.name,
      kind: dto.kind,
      depotId: dto.depotId,
      productId: dto.productId,
      categoryId: dto.categoryId,
      specialPrice: dto.specialPrice,
      buyQty: dto.buyQty,
      getQty: dto.getQty,
      shippingFeeOverride: dto.shippingFeeOverride,
      percentOff: dto.percentOff,
      minSubtotal: dto.minSubtotal,
      discountAmount: dto.discountAmount,
      giftProductId: dto.giftProductId,
      firstOrderOnly: dto.firstOrderOnly,
      validFrom: toDate(dto.validFrom),
      validUntil: toDate(dto.validUntil),
      daysOfWeek: dto.daysOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
      minQty: dto.minQty,
      maxQty: dto.maxQty,
      channels: dto.channels,
      active: dto.active,
    }, dto.seenUpdatedAt);
  }

  @ApiOkResponse({ description: 'No content.' })
  @ApiBearerAuth()
  @Can('promoRuleWrite')
  @Delete('promo-rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a promo rule (admin)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    const row = await this.promoRules.findById(id);
    assertDepotAccess(user, row.depotId);
    await this.promoRules.remove(id);
  }

  @ApiOkResponse({ type: AutoApplyQuoteResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('auto-apply/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview auto-apply promo adjustments for a cart (internal service auth)' })
  async quote(@Body() dto: AutoApplyQuoteDto): Promise<AutoApplyQuoteResponseDto> {
    const result = await this.promoRules.quote({
      depotId: dto.depotId ?? null,
      channel: dto.channel,
      occurredAt: new Date(),
      lines: toQuoteLines(dto),
      firstOrder: dto.firstOrder === true,
    });
    return toQuoteResponse(result);
  }

  @ApiOkResponse({ description: 'No content.' })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('auto-apply/apply')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Commit auto-apply promo adjustments for an order (internal service auth, idempotent)',
  })
  async apply(@Body() dto: AutoApplyApplyDto): Promise<void> {
    await this.promoRules.apply({
      orderId: dto.orderId,
      originalLines: dto.lines.map((l) => ({
        productId: l.productId,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
      })),
      quotedLines: dto.lines.map((l) => ({
        productId: l.productId,
        appliedRuleIds: l.appliedRuleIds,
        unitPriceAfter: l.unitPriceAfter,
        freeQty: l.freeQty,
        lineTotal: l.unitPriceAfter * l.quantity,
      })),
      quotedShipping: {
        appliedRuleId: dto.shippingAppliedRuleId ?? null,
        shippingFeeOverride: dto.shippingFeeOverride ?? null,
      },
      originalShippingFee: dto.originalShippingFee ?? null,
      shippingUnits: dto.shippingUnits,
      orderDiscount: dto.orderDiscountRuleId
        ? { appliedRuleId: dto.orderDiscountRuleId, amount: dto.orderDiscountAmount ?? 0 }
        : undefined,
      gifts: dto.gifts,
    });
  }
}
