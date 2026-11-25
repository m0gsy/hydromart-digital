import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import {
  AuditMutationsInterceptor,
  AuthenticatedUser,
  Can,
  CurrentUser,
  ExternalAccess,
} from '@hydromart/platform';

import { PriceOverrideService } from '../application/services/price-override.service';
import { PurchaseOrderService } from '../application/services/purchase-order.service';
import { PriceOverrideProposalRecord } from '../domain/price-override-proposal';
import { PurchaseOrder } from '../domain/purchase-order';
import { AiPriceOverrideDraftDto, AiPurchaseOrderDraftDto } from './dto/ai-draft.dto';
import {
  PriceOverrideProposalResponseDto,
  PurchaseOrderResponseDto,
} from './dto/responses.generated.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The AI web's idempotency key, one spelling so an upper-case retry is the same suggestion. */
function suggestionId(raw: string | undefined): string {
  if (!raw || !UUID.test(raw)) {
    throw new BadRequestException('X-AI-Suggestion-Id must be a UUID.');
  }
  return raw.toLowerCase();
}

/** 201 for the first call, 200 for a retry that finds the draft it already made. */
function status(res: Response, replayed: boolean): void {
  res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
}

/*
 * HD-17 part A: the closed list of drafts the AI web's token may make in depot-service
 * (contracts/ai-v1/drafts.openapi.json). Only the AI token is let in (a staff session has its own
 * routes), and the person behind it must hold what the staff create route asks: the same
 * capability, the same depot scope (DepotScopeGuard reads the body's depotId). A draft is never a
 * decision: a price proposal is PENDING for HQ, a purchase order is DRAFT until staff press Kirim.
 * Approve, reject, import, send and receive carry no @ExternalAccess, so the AI token gets 403.
 */
@ApiTags('AI drafts')
@ApiBearerAuth()
@Controller({ path: 'ai/drafts', version: '1' })
export class AiDraftController {
  constructor(
    private readonly overrides: PriceOverrideService,
    private readonly orders: PurchaseOrderService,
  ) {}

  private static aiOnly(user: AuthenticatedUser): void {
    if (user.via !== 'ai') throw new ForbiddenException('Only the AI web token may draft here.');
  }

  @ApiOkResponse({ type: PriceOverrideProposalResponseDto })
  @ExternalAccess('ai')
  @Can('depotAdmin')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('price-overrides')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'AI: draft a PENDING price proposal for HQ to decide (HD-17)' })
  async priceOverride(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-ai-suggestion-id') header: string | undefined,
    @Body() dto: AiPriceOverrideDraftDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PriceOverrideProposalRecord> {
    AiDraftController.aiOnly(user);
    const id = suggestionId(header);
    const { draft, replayed } = await this.overrides.draftFromAi(
      dto.depotId,
      user.sub,
      {
        productId: dto.productId,
        productName: dto.productName,
        currentPrice: dto.currentPrice,
        adjustType: dto.adjustType,
        value: dto.value,
        note: dto.note ?? null,
      },
      { suggestionId: id, reason: dto.reason },
    );
    status(res, replayed);
    return draft;
  }

  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  @ExternalAccess('ai')
  @Can('procurement')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('purchase-orders')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'AI: draft a purchase order that staff review and send (HD-17)' })
  async purchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-ai-suggestion-id') header: string | undefined,
    @Body() dto: AiPurchaseOrderDraftDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PurchaseOrder> {
    AiDraftController.aiOnly(user);
    const id = suggestionId(header);
    const { draft, replayed } = await this.orders.draftFromAi(
      {
        depotId: dto.depotId,
        supplierId: dto.supplierId,
        lines: dto.lines,
        shippingIdr: dto.shippingIdr,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
      },
      { suggestionId: id, reason: dto.reason },
    );
    status(res, replayed);
    return draft;
  }
}
