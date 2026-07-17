import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser, Role, Roles } from '@hydromart/platform';

import { AdminNotificationPrefService } from '../application/services/admin-notification-pref.service';
import {
  AdminNotificationPrefsDto,
  SaveAdminNotificationPrefsDto,
} from './dto/admin-notification-pref.dto';

// Design 23a — per-admin notification channel prefs. Any HQ user manages THEIR OWN prefs
// (keyed by the auth `sub`), so both roles are allowed but each only ever sees/writes its own.
@ApiTags('Notification preferences')
@ApiBearerAuth()
@Roles(Role.HEAD_OFFICE, Role.SUPER_ADMIN)
@Controller({ path: 'notification-prefs', version: '1' })
export class NotificationPrefsController {
  constructor(private readonly prefs: AdminNotificationPrefService) {}

  @Get()
  @ApiOperation({ summary: "Read the current user's notification prefs (23a)" })
  async get(@CurrentUser() user: AuthenticatedUser): Promise<AdminNotificationPrefsDto> {
    return AdminNotificationPrefsDto.from(await this.prefs.get(user.sub));
  }

  @Put()
  @ApiOperation({ summary: "Replace the current user's notification prefs" })
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveAdminNotificationPrefsDto,
  ): Promise<AdminNotificationPrefsDto> {
    return AdminNotificationPrefsDto.from(await this.prefs.save(user.sub, dto.events));
  }
}
