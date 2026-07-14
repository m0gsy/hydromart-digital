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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Roles } from '@hydromart/platform';
import { CAPABILITIES } from '@hydromart/access';

import { CampaignService } from '../application/services/campaign.service';
import {
  CampaignDto,
  CampaignListDto,
  CampaignPageQueryDto,
  CreateCampaignDto,
} from './dto/campaign.dto';

@ApiTags('Campaigns')
@ApiBearerAuth()
@Controller({ path: 'campaigns', version: '1' })
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Roles(...CAPABILITIES.campaignWrite)
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
    );
    return CampaignDto.from(campaign);
  }

  @Roles(...CAPABILITIES.campaignRead)
  @Get()
  @ApiOperation({ summary: 'List broadcast campaigns (paginated)' })
  async list(@Query() query: CampaignPageQueryDto): Promise<CampaignListDto> {
    return CampaignListDto.from(await this.campaigns.list(query.page, query.limit));
  }

  @Roles(...CAPABILITIES.campaignRead)
  @Get(':id')
  @ApiOperation({ summary: 'Get a campaign with its recipients' })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return CampaignDto.from(await this.campaigns.get(id));
  }

  @Roles(...CAPABILITIES.campaignWrite)
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispatch a draft campaign to all recipients (FR-094)' })
  async send(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return CampaignDto.from(await this.campaigns.send(id));
  }
}
