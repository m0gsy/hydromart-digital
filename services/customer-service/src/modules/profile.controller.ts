import { Body, Controller, Get, Headers, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { CustomerProfileRecord } from '../application/ports/profile.repository';
import { ProfileService } from '../application/services/profile.service';
import { NotificationService } from '../application/services/notification.service';
import {
  BirthdayRewardResultDto,
  ProfileResponseDto,
  UpdateNotificationsDto,
  UpdateProfileDto,
} from './dto/profile.dto';

function toProfileResponse(p: CustomerProfileRecord): ProfileResponseDto {
  return {
    customerId: p.customerId,
    membershipTier: p.membershipTier,
    pointBalance: p.pointBalance,
    favoriteDepotId: p.favoriteDepotId,
    birthdate: p.birthdate ? p.birthdate.toISOString().slice(0, 10) : null,
  };
}

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
    return toProfileResponse(await this.profiles.get(user.sub));
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update my profile (favorite depot, date of birth)' })
  @ApiOkResponse({ type: ProfileResponseDto })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    let p = await this.profiles.get(user.sub);
    if ('favoriteDepotId' in dto) {
      p = await this.profiles.setFavoriteDepot(user.sub, dto.favoriteDepotId ?? null);
    }
    if ('birthdate' in dto) {
      p = await this.profiles.setBirthdate(user.sub, dto.birthdate ? new Date(dto.birthdate) : null);
    }
    return toProfileResponse(p);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post('profile/birthday-rewards')
  @ApiOperation({ summary: 'Grant birthday points to today’s birthday customers (admin/scheduler, FR-091)' })
  @ApiOkResponse({ type: BirthdayRewardResultDto })
  async runBirthdayRewards(
    @Headers('authorization') authorization: string,
  ): Promise<BirthdayRewardResultDto> {
    return this.profiles.runBirthdayRewards(authorization);
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
