import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { CampaignService } from '../application/services/campaign.service';
import {
  CampaignDto,
  CampaignListDto,
  CampaignPageQueryDto,
  CreateCampaignDto,
} from './dto/campaign.dto';

// Marketing owns broadcast campaigns; SUPER_ADMIN can act everywhere. HEAD_OFFICE gets
// read-only visibility for oversight.
const WRITE_ROLES = [Role.MARKETING, Role.SUPER_ADMIN] as const;
const READ_ROLES = [Role.MARKETING, Role.HEAD_OFFICE, Role.SUPER_ADMIN] as const;

@ApiTags('Campaigns')
@ApiBearerAuth()
@Controller({ path: 'campaigns', version: '1' })
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Roles(...WRITE_ROLES)
  @Post()
  @ApiOperation({ summary: 'Create a draft broadcast campaign (FR-088/FR-094)' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCampaignDto,
  ): Promise<CampaignDto> {
    const campaign = await this.campaigns.create(
      user.sub,
      dto.name,
      dto.messageTemplate,
      dto.recipients,
    );
    return CampaignDto.from(campaign);
  }

  @Roles(...READ_ROLES)
  @Get()
  @ApiOperation({ summary: 'List broadcast campaigns (paginated)' })
  async list(@Query() query: CampaignPageQueryDto): Promise<CampaignListDto> {
    return CampaignListDto.from(await this.campaigns.list(query.page, query.limit));
  }

  @Roles(...READ_ROLES)
  @Get(':id')
  @ApiOperation({ summary: 'Get a campaign with its recipients' })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return CampaignDto.from(await this.campaigns.get(id));
  }

  @Roles(...WRITE_ROLES)
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispatch a draft campaign to all recipients (FR-094)' })
  async send(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignDto> {
    return CampaignDto.from(await this.campaigns.send(id));
  }
}
