import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Public, Role, Roles } from '@hydromart/platform';

import { RewardService } from '../application/services/reward.service';
import { RedeemRewardDto, RedeemResultDto, RewardItemDto } from './dto/reward.dto';

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
