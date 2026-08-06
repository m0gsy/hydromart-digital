import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Can, AuthenticatedUser, CurrentUser, Public, Role, Roles } from '@hydromart/platform';

import { RewardService } from '../application/services/reward.service';
import {
  CreateRewardItemDto,
  RedeemRewardDto,
  RedeemResultDto,
  RedemptionDto,
  RedemptionListItemDto,
  RewardItemDto,
  UpdateRewardItemDto,
} from './dto/reward.dto';

// Catalogue management sits with the roles that already adjust points by hand.
const MANAGE_ROLES = [Role.MARKETING, Role.SUPER_ADMIN] as const;

@ApiTags('Rewards')
@Controller({ path: 'rewards', version: '1' })
export class RewardController {
  constructor(private readonly rewards: RewardService) {}

  @ApiOkResponse({ type: RewardItemDto, isArray: true })
  @Public()
  @Get('catalog')
  @ApiOperation({ summary: 'List redeemable reward items (FR-015)' })
  async catalog(): Promise<RewardItemDto[]> {
    const items = await this.rewards.listCatalog();
    return items.map((i) => RewardItemDto.from(i));
  }

  // Catalogue management (design 15c). Until this shipped the table could only be edited
  // with SQL — stock and prices had no admin path at all.
  @ApiOkResponse({ type: RewardItemDto, isArray: true })
  @ApiBearerAuth()
  @Roles(...MANAGE_ROLES)
  @Get('items')
  @ApiOperation({ summary: 'List every reward item, retired ones included' })
  async items(): Promise<RewardItemDto[]> {
    const items = await this.rewards.listAll();
    return items.map((i) => RewardItemDto.from(i));
  }

  @ApiOkResponse({ type: RewardItemDto })
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

  @ApiOkResponse({ type: RewardItemDto })
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

  @ApiOkResponse({ type: RedeemResultDto })
  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @Post('redeem')
  @ApiOperation({ summary: 'Redeem points for a reward item (idempotent, FR-015)' })
  async redeem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RedeemRewardDto,
  ): Promise<RedeemResultDto> {
    const result = await this.rewards.redeem(
      user.sub,
      dto.rewardItemId,
      dto.idempotencyKey,
      dto.depotId,
    );
    return RedeemResultDto.from(result);
  }

  @ApiOkResponse({ type: RedemptionListItemDto, isArray: true })
  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @Get('redemptions/me')
  @ApiOperation({
    summary: 'Your own redemptions, newest first (M14-03)',
    description: 'ACTIVE rows are the ones you can still cancel.',
  })
  async myRedemptions(@CurrentUser() user: AuthenticatedUser): Promise<RedemptionListItemDto[]> {
    const rows = await this.rewards.listMine(user.sub);
    return rows.map((r) => RedemptionListItemDto.fromView(r));
  }

  @ApiOkResponse({ type: RedemptionListItemDto, isArray: true })
  @ApiBearerAuth()
  @Can('rewardHandover')
  @Get('redemptions/active')
  @ApiOperation({
    summary: 'Redemptions still waiting to be handed over, oldest first (M14-03)',
    description:
      'With ?depotId= the queue is that depot plus legacy rows that recorded no depot; without it, the whole network (head office).',
  })
  async activeRedemptions(@Query('depotId') depotId?: string): Promise<RedemptionListItemDto[]> {
    const rows = await this.rewards.listAwaitingHandover(depotId || undefined);
    return rows.map((r) => RedemptionListItemDto.fromView(r));
  }

  @ApiOkResponse({ type: RedeemResultDto })
  @ApiBearerAuth()
  @Roles(Role.CUSTOMER)
  @Post('redemptions/:id/cancel')
  @ApiOperation({
    summary: 'Cancel your own redemption and get the points back (M14-03)',
    description: 'Refused once staff marked the reward as handed over.',
  })
  async cancelRedemption(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RedeemResultDto> {
    return RedeemResultDto.from(await this.rewards.cancel(user.sub, id));
  }

  @ApiOkResponse({ type: RedemptionDto })
  @ApiBearerAuth()
  @Can('rewardHandover')
  @Post('redemptions/:id/used')
  @ApiOperation({
    summary: 'Mark a redemption as handed over; closes the cancellation window (M14-03)',
  })
  async markRedemptionUsed(@Param('id', ParseUUIDPipe) id: string): Promise<RedemptionDto> {
    return RedemptionDto.from(await this.rewards.markUsed(id));
  }
}
