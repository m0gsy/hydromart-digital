import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import {
  Can,
  AuthenticatedUser,
  CurrentUser,
  InternalAuthGuard,
  Public,
} from '@hydromart/platform';

import {
  CampaignService,
  CampaignSweepResult,
} from '../application/services/campaign.service';
import {
  CampaignDto,
  CampaignListDto,
  CampaignPageQueryDto,
  CreateCampaignDto,
  CreateDepotCampaignDto,
} from './dto/campaign.dto';

@ApiTags('Campaigns')
@ApiBearerAuth()
@Controller({ path: 'campaigns', version: '1' })
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @ApiOkResponse({ type: CampaignDto })
  @Can('campaignWrite')
  @Post()
  @ApiOperation({ summary: 'Create a draft broadcast campaign — explicit list or segment (FR-087/088/094)' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCampaignDto,
    @Headers('authorization') authorization: string,
  ): Promise<CampaignDto> {
    const campaign = await this.campaigns.create(
      user.sub,
      dto.name,
      dto.messageTemplate,
      dto.recipients,
      dto.segment,
      authorization,
      dto.scheduledFor ? new Date(dto.scheduledFor) : null,
    );
    return CampaignDto.from(campaign);
  }

  /**
   * A depot's own customer blast (design 11a).
   *
   * `depotId` sits at the TOP level of the body on purpose: that is where DepotScopeGuard
   * looks, so a depot-locked caller naming somebody else's depot is refused before this
   * method runs, and head office keeps the ability to blast on a depot's behalf.
   */
  @ApiOkResponse({ type: CampaignDto })
  @Can('depotCampaign')
  @Post('depot')
  @ApiOperation({ summary: "Create a draft campaign for one depot's own customers (11a)" })
  async createForDepot(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepotCampaignDto,
  ): Promise<CampaignDto> {
    const campaign = await this.campaigns.createForDepot(
      user.sub,
      dto.depotId,
      dto.name,
      dto.messageTemplate,
      dto.segment,
      dto.scheduledFor ? new Date(dto.scheduledFor) : null,
    );
    return CampaignDto.from(campaign);
  }

  @ApiOkResponse({ type: CampaignListDto })
  @Can('campaignRead')
  @Get()
  @ApiOperation({ summary: 'List broadcast campaigns (paginated)' })
  async list(@Query() query: CampaignPageQueryDto): Promise<CampaignListDto> {
    return CampaignListDto.from(await this.campaigns.list(query.page, query.limit));
  }

  @ApiOkResponse({ type: CampaignDto })
  @Can('campaignRead')
  @Get(':id')
  @ApiOperation({ summary: 'Get a campaign with its recipients' })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return CampaignDto.from(await this.campaigns.get(id));
  }

  @ApiOkResponse({ type: CampaignDto })
  @Can('campaignWrite')
  @Post(':id/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue a draft campaign for broadcast (FR-094)',
    description:
      'Returns as soon as the campaign is claimed. Delivery runs on the scheduler sweep — poll GET /campaigns/:id for progress. This used to send every recipient inside the request and time out at the proxy on any real list (B-17).',
  })
  async send(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return CampaignDto.from(await this.campaigns.send(id));
  }

  /**
   * The broadcast worker, driven by the scheduler sidecar (crond has no JWT to present).
   * @Public() bypasses the global JWT guard; InternalAuthGuard is then the sole,
   * fail-closed auth — the same shape as every other internal sweep in the repo.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/process-sending')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Counts for this tick: campaigns walked, messages sent, failed, completed.',
  })
  @ApiOperation({
    summary: 'Continue every campaign still broadcasting (internal service auth)',
    description:
      'Bounded per tick and resumable: whatever is not reached stays PENDING for the next sweep.',
  })
  processSending(): Promise<CampaignSweepResult> {
    return this.campaigns.processSending();
  }
}
