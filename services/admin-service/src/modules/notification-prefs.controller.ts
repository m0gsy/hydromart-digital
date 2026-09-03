import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { can } from '@hydromart/access';
import {
  AuditMutationsInterceptor,
  AuthenticatedUser,
  Can,
  CurrentUser,
} from '@hydromart/platform';

import {
  AdminNotificationPrefService,
  NotificationScope,
} from '../application/services/admin-notification-pref.service';
import {
  AdminNotificationPrefsDto,
  SaveAdminNotificationPrefsDto,
} from './dto/admin-notification-pref.dto';

// Design 23a — per-account notification channel prefs. Any staff member manages THEIR OWN
// prefs (keyed by the auth `sub`), which is why the capability is wide: holding it lets an
// account change nothing but what its own phone buzzes for.
//
// The event list served depends on the caller: an HQ account gets both lists (head office
// holds `opsNotif` too), a depot account gets the depot events only. Scope is derived from
// the ROLE, never taken from the request — a body-supplied scope would let a depot account
// write HQ prefs it cannot see.
/**
 * Which event list this role owns. Head office holds `opsNotif` as well as `hqConsole`, so
 * an HQ account owns BOTH lists — there is no HQ-only audience to serve.
 */
function scopeFor(role: string | null | undefined): NotificationScope {
  return can('hqConsole', role) ? 'ALL' : 'DEPOT';
}

@ApiTags('Notification preferences')
@ApiBearerAuth()
@Can('ownNotifPrefs')
// CA-2-67: every write below reaches the audit trail. See AuditMutationsInterceptor.
@UseInterceptors(AuditMutationsInterceptor)
@Controller({ path: 'notification-prefs', version: '1' })
export class NotificationPrefsController {
  constructor(private readonly prefs: AdminNotificationPrefService) {}

  @ApiOkResponse({ type: AdminNotificationPrefsDto })
  @Get()
  @ApiOperation({ summary: "Read the current user's notification prefs (23a)" })
  async get(@CurrentUser() user: AuthenticatedUser): Promise<AdminNotificationPrefsDto> {
    return AdminNotificationPrefsDto.from(await this.prefs.get(user.sub, scopeFor(user.role)));
  }

  @ApiOkResponse({ type: AdminNotificationPrefsDto })
  @Put()
  @ApiOperation({ summary: "Replace the current user's notification prefs" })
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveAdminNotificationPrefsDto,
  ): Promise<AdminNotificationPrefsDto> {
    return AdminNotificationPrefsDto.from(
      await this.prefs.save(user.sub, dto.events, scopeFor(user.role)),
    );
  }
}
