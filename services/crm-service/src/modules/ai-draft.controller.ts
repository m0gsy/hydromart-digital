import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  Res,
  UseGuards,
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

import { CampaignService } from '../application/services/campaign.service';
import { AiCampaignDraftDto, AiCampaignDraftResponseDto } from './dto/ai-draft.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The AI web's idempotency key, one spelling so an upper-case retry is the same suggestion. */
function suggestionId(raw: string | undefined): string {
  if (!raw || !UUID.test(raw)) {
    throw new BadRequestException('X-AI-Suggestion-Id must be a UUID.');
  }
  return raw.toLowerCase();
}

/**
 * Runs after the global guards (the user is set) and BEFORE the validation pipe, so a staff or
 * machine token is refused 403 whatever its body looks like. (Same guard as depot-service's.)
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
 * HD-17: the one draft the AI web's token may make in crm-service
 * (contracts/ai-v1/drafts.openapi.json). Only the AI token is let in, and the person behind it
 * must hold what the staff depot-campaign route asks: `depotCampaign`, at that depot
 * (DepotScopeGuard reads the body's depotId). The draft is a DRAFT: nothing is sent. Send, cancel,
 * the list and the report carry no @ExternalAccess, so the AI token gets 403 there; it cannot edit
 * a campaign at all, and the answer carries the audience size only, never a recipient.
 */
@ApiTags('AI drafts')
@ApiBearerAuth()
@UseGuards(AiTokenOnlyGuard)
@Controller({ path: 'ai/drafts', version: '1' })
export class AiDraftController {
  constructor(private readonly campaigns: CampaignService) {}

  @ApiOkResponse({ type: AiCampaignDraftResponseDto })
  @ExternalAccess('ai')
  @Can('depotCampaign')
  @UseInterceptors(AuditMutationsInterceptor)
  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'AI: draft an in-app/push campaign that staff review and send (HD-17)' })
  async campaign(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-ai-suggestion-id') header: string | undefined,
    @Body() dto: AiCampaignDraftDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AiCampaignDraftResponseDto> {
    const id = suggestionId(header);
    const { draft, replayed } = await this.campaigns.draftFromAi(
      user.sub,
      dto.depotId,
      {
        name: dto.name,
        messageTemplate: dto.messageTemplate,
        segment: dto.segment,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
      },
      { suggestionId: id, reason: dto.reason },
    );
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return AiCampaignDraftResponseDto.fromDraft(draft);
  }
}
