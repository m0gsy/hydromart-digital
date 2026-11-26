import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Headers,
  Logger,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { can } from '@hydromart/access';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import {
  AuditMutationsInterceptor,
  AuthenticatedUser,
  Can,
  CurrentUser,
  ExternalAccess,
  isDepotLocked,
  recordAuditEvent,
} from '@hydromart/platform';

import { DepotDraftService, DepotDraftStatusView } from '../application/services/depot-draft.service';
import { DepotConfigService } from '../config/depot-config.service';
import { FranchiseApplicationService, LegacyApplicationView } from '../application/services/franchise-application.service';
import { LegalEntityService } from '../application/services/legal-entity.service';
import { PriceOverrideService } from '../application/services/price-override.service';
import { PurchaseOrderService } from '../application/services/purchase-order.service';
import { PriceOverrideProposalRecord } from '../domain/price-override-proposal';
import { PurchaseOrder } from '../domain/purchase-order';
import { AiPriceOverrideDraftDto, AiPurchaseOrderDraftDto } from './dto/ai-draft.dto';
import {
  CrmAccessResponseDto,
  CrmDepotDraftDto,
  CrmDepotDraftResponseDto,
  CrmDepotDraftStatusResponseDto,
} from './dto/ai-crm.dto';
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

/**
 * Runs after the global guards (the user is set) and BEFORE the validation pipe, so a staff or
 * machine token is refused 403 whatever its body looks like.
 */
@Injectable()
export class AiTokenOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (user?.via !== 'ai') throw new ForbiddenException('Only the AI web token may draft here.');
    return true;
  }
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
@UseGuards(AiTokenOnlyGuard)
@Controller({ path: 'ai/drafts', version: '1' })
export class AiDraftController {
  constructor(
    private readonly overrides: PriceOverrideService,
    private readonly orders: PurchaseOrderService,
    private readonly depotDrafts: DepotDraftService,
  ) {}

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
    @Headers('x-ai-suggestion-id') header: string | undefined,
    @Body() dto: AiPurchaseOrderDraftDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PurchaseOrder> {
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

  /**
   * HD-21a: the CRM's depot draft for a prospect. Never a depot: HQ activates it later. The
   * cooling-off and checklist are re-checked here (D1), whatever the CRM already checked.
   */
  @ApiOkResponse({ type: CrmDepotDraftResponseDto })
  @ExternalAccess('ai')
  @Can('prospectCrm')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('depots/from-crm')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'AI web CRM: draft a depot from a calon mitra for HQ to activate (HD-21)' })
  async depotFromCrm(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-ai-suggestion-id') header: string | undefined,
    @Body() dto: CrmDepotDraftDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ draftId: string; status: 'DRAFT'; createdAt: Date }> {
    const id = suggestionId(header);
    const { owner, checklist, prospectId: rawProspectId, legacyApplicationId, ...rest } = dto;
    // One spelling of an id, before the request hash: an upper-case retry is the same prospect.
    const prospectId = rawProspectId.toLowerCase();
    if (id !== prospectId) {
      throw new BadRequestException('X-AI-Suggestion-Id must equal the prospectId of the body.');
    }
    const { draft, replayed } = await this.depotDrafts.draftFromCrm(
      prospectId,
      {
        ...rest,
        legacyApplicationId: legacyApplicationId?.toLowerCase() ?? null,
        ownerFullName: owner.fullName,
        ownerPhoneE164: owner.phoneE164,
        checklist: { ...checklist },
      },
      { suggestionId: id, createdBy: user.sub },
    );
    status(res, replayed);
    return { draftId: draft.id, status: 'DRAFT', createdAt: draft.createdAt };
  }

  @ApiOkResponse({ type: CrmDepotDraftStatusResponseDto })
  @ExternalAccess('ai')
  @Can('prospectCrm')
  @Get('depots/from-crm/:prospectId')
  @ApiOperation({ summary: 'AI web CRM: where the depot draft of a calon mitra stands (HD-21)' })
  statusFromCrm(@Param('prospectId', ParseUUIDPipe) prospectId: string): Promise<DepotDraftStatusView> {
    return this.depotDrafts.statusOf(prospectId.toLowerCase());
  }
}

/**
 * HD-21a: what the signed-in person may do in the CRM calon mitra, evaluated with the RUNTIME
 * matrix (`can` reads the loaded overrides and custom roles, as RolesGuard does).
 */
@ApiTags('AI drafts')
@ApiBearerAuth()
@UseGuards(AiTokenOnlyGuard)
@Controller({ path: 'ai/crm', version: '1' })
export class AiCrmController {
  private readonly logger = new Logger(AiCrmController.name);

  constructor(
    private readonly entities: LegalEntityService,
    private readonly applications: FranchiseApplicationService,
    private readonly config: DepotConfigService,
  ) {}

  @ApiOkResponse({ type: CrmAccessResponseDto })
  @ExternalAccess('ai')
  @Can('prospectRead')
  @Get('access')
  @ApiOperation({ summary: 'AI web CRM: full / settings access and the legal entities the caller may act for' })
  async access(@CurrentUser() user: AuthenticatedUser): Promise<CrmAccessResponseDto> {
    // RolesGuard's own call: a depot-locked person is judged at their depot, so a per-depot
    // grant or deny shows here exactly as it would on the route.
    const depots = isDepotLocked(user.role) && user.depotId ? [user.depotId] : undefined;
    return {
      full: can('prospectCrm', user.role, depots),
      settings: can('prospectSettings', user.role, depots),
      legalEntities: await this.entities.accessibleTo(user.role),
    };
  }

  /**
   * HD-21 section 5 (D10): the open /waralaba applications for the CRM's one-time import. Needs
   * prospectSettings. Read only; the hydromart copies are deleted later by a reviewed one-shot
   * through the pipeline, never by the AI token.
   */
  @ApiOkResponse({ description: '`{ applications: [...] }`: PENDING, DOC_VERIFICATION and SURVEY only, oldest first.' })
  @ExternalAccess('ai')
  @Can('prospectSettings')
  @Get('legacy-applications')
  @ApiOperation({ summary: 'AI web CRM: the open franchise applications to import as prospects (HD-21)' })
  async legacyApplications(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ applications: LegacyApplicationView[]; truncated: boolean }> {
    const result = await this.applications.openForCrm();
    // One event per call: who read the export and how much, never what (no name, no phone).
    await recordAuditEvent(
      { authServiceUrl: this.config.authServiceUrl, internalServiceKey: this.config.internalServiceKey },
      {
        action: 'ai.crm.legacy-applications.read',
        actorId: user.sub,
        target: 'franchise_applications',
        metadata: { via: 'ai', count: result.applications.length, truncated: result.truncated },
      },
      this.logger,
    );
    return result;
  }
}
