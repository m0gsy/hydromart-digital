import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Public, Role, Roles } from '@hydromart/platform';

import { RewardService } from '../application/services/reward.service';
import {
  CreateRewardItemDto,
  RedeemRewardDto,
  RedeemResultDto,
  RewardItemDto,
  UpdateRewardItemDto,
} from './dto/reward.dto';

// Catalogue management sits with the roles that already adjust points by hand.
const MANAGE_ROLES = [Role.MARKETING, Role.SUPER_ADMIN] as const;

@ApiTags('Rewards')
@Controller({ path: 'rewards', version: '1' })
export class RewardController {
  constructor(private readonly rewards: RewardService) {}

  @Public()
  @Get('catalog')
  @ApiOperation({ summary: 'List redeemable reward items (FR-015)' })
  async catalog(): Promise<RewardItemDto[]> {
    const items = await this.rewards.listCatalog();
    return items.map((i) => RewardItemDto.from(i));
  }

  // Catalogue management (design 15c). Until this shipped the table could only be edited
  // with SQL — stock and prices had no admin path at all.
  @ApiBearerAuth()
  @Roles(...MANAGE_ROLES)
  @Get('items')
  @ApiOperation({ summary: 'List every reward item, retired ones included' })
  async items(): Promise<RewardItemDto[]> {
    const items = await this.rewards.listAll();
    return items.map((i) => RewardItemDto.from(i));
  }

  @ApiBearerAuth()
  @Roles(...MANAGE_ROLES)
  @Post('items')
  @ApiOperation({ summary: 'Add a reward item to the catalogue' })
  async createItem(@Body() dto: CreateRewardItemDto): Promise<RewardItemDto> {
    return RewardItemDto.from(
      await this.rewards.createItem({
        name: dto.name,
        unit: dto.unit,
        pointsCost: dto.pointsCost,
        imageUrl: dto.imageUrl ?? null,
        stock: dto.stock ?? null,
        active: dto.active ?? true,
      }),
    );
  }

  @ApiBearerAuth()
  @Roles(...MANAGE_ROLES)
  @Patch('items/:id')
  @ApiOperation({ summary: 'Edit price/stock/label, or retire the item with active:false' })
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRewardItemDto,
  ): Promise<RewardItemDto> {
    return RewardItemDto.from(await this.rewards.updateItem(id, dto));
  }

  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @Post('redeem')
  @ApiOperation({ summary: 'Redeem points for a reward item (idempotent, FR-015)' })
  async redeem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemRewardDto,
  ): Promise<RedeemResultDto> {
    const result = await this.rewards.redeem(user.sub, dto.rewardItemId, dto.idempotencyKey);
    return RedeemResultDto.from(result);
  }
}
