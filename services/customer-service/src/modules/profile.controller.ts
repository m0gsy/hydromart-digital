import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { ProfileService } from '../application/services/profile.service';
import { NotificationService } from '../application/services/notification.service';
import { ProfileResponseDto, UpdateNotificationsDto, UpdateProfileDto } from './dto/profile.dto';

@ApiTags('Profile')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly notifications: NotificationService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get my customer profile' })
  @ApiOkResponse({ type: ProfileResponseDto })
  async getProfile(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponseDto> {
    const p = await this.profiles.get(user.sub);
    return {
      customerId: p.customerId,
      membershipTier: p.membershipTier,
      pointBalance: p.pointBalance,
      favoriteDepotId: p.favoriteDepotId,
    };
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update my profile (favorite depot)' })
  @ApiOkResponse({ type: ProfileResponseDto })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    const p = await this.profiles.setFavoriteDepot(user.sub, dto.favoriteDepotId ?? null);
    return {
      customerId: p.customerId,
      membershipTier: p.membershipTier,
      pointBalance: p.pointBalance,
      favoriteDepotId: p.favoriteDepotId,
    };
  }

  @Get('profile/notifications')
  @ApiOperation({ summary: 'Get my notification preferences' })
  async getNotifications(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.get(user.sub);
  }

  @Patch('profile/notifications')
  @ApiOperation({ summary: 'Update my notification preferences' })
  async updateNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationsDto,
  ) {
    return this.notifications.update(user.sub, dto);
  }
}
