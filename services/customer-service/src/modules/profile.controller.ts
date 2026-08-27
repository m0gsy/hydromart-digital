import { Body, Controller, Get, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { CustomerProfileRecord, DirectoryRecipient } from '../application/ports/profile.repository';
import { ProfileService } from '../application/services/profile.service';
import { NotificationService } from '../application/services/notification.service';
import {
  BirthdayRewardResultDto,
  BirthdaySweepResultDto,
  DirectoryQueryDto,
  DirectoryRecipientDto,
  ProfileResponseDto,
  UpdateNotificationsDto,
  UpdateProfileDto,
} from './dto/profile.dto';
import { NotificationPreferenceRecord } from '../application/ports/notification.repository';
import {
  CustomerDepotDepositRowResponseDto,
  NotificationPreferenceResponseDto,
} from './dto/responses.generated.dto';
import { CustomerDepotDepositRow } from '../application/ports/depot-ledger.port';

function toProfileResponse(p: CustomerProfileRecord): ProfileResponseDto {
  return {
    customerId: p.customerId,
    membershipTier: p.membershipTier,
    pointBalance: p.pointBalance,
    favoriteDepotId: p.favoriteDepotId,
    // tz-ok: birthdate is @db.Date (UTC-midnight) — the slice IS the calendar date, and
    // a birthday has no time of day to shift.
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

  /**
   * I5: my gallons on loan and my deposit still held, per depot.
   *
   * Scoped to the caller's own session — the customer id never comes off the request, so
   * one customer cannot read another's deposit. `null` from depot-service is passed through
   * as `null`, not flattened to `[]`: the screen must say "belum tersambung" rather than
   * print a zero nobody checked, because a zero here reads as "you have no deposit".
   */
  @Get('profile/gallon-deposit')
  @ApiOperation({ summary: 'My gallons on loan and deposit held, per depot' })
  @ApiOkResponse({ type: CustomerDepotDepositRowResponseDto, isArray: true })
  myGallonDeposits(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CustomerDepotDepositRow[] | null> {
    return this.profiles.myGallonDeposits(user.sub);
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

  @Can('customerDirectory')
  @Get('profile/directory')
  @ApiOperation({ summary: 'Staff: list broadcast recipients by segment (tier/city) for CRM (FR-087)' })
  @ApiOkResponse({ type: [DirectoryRecipientDto] })
  async directory(@Query() query: DirectoryQueryDto): Promise<DirectoryRecipient[]> {
    return this.profiles.findSegment({ tier: query.tier, city: query.city });
  }

  /**
   * The same audience, for a service rather than a signed-in marketer.
   *
   * A depot manager composing a blast to their own customers has `depotCampaign`, not the
   * head-office right to page through the customer directory — so crm resolves that
   * audience under the shared internal key instead of forwarding their token. It calls the
   * SAME service method as the bearer route above, because a directory that answered one
   * way to a person and another way to a service would be two audiences again.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('profile/internal/directory')
  @ApiOperation({ summary: 'Broadcast recipients by segment for crm (internal service auth)' })
  @ApiOkResponse({ type: [DirectoryRecipientDto] })
  async internalDirectory(@Query() query: DirectoryQueryDto): Promise<DirectoryRecipient[]> {
    return this.profiles.findSegment({ tier: query.tier, city: query.city });
  }

  /**
   * F1: one customer's channel preferences, for the service that does the sending.
   *
   * crm-service owns delivery and this service owns the profile, so the toggle on
   * `/account` was written here and read by nobody — a switch that moved a row and
   * changed nothing observable. Internal key rather than a bearer because there is
   * usually no caller to borrow one from: a notification is fired by an order webhook,
   * a cron, or a courier's proof of delivery.
   *
   * Returns the same defaults-applied record as the customer's own route, so "never
   * touched the toggle" and "turned it on" answer identically instead of 404-ing.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Get('profile/internal/notifications')
  @ApiOperation({ summary: 'One customer’s notification channel preferences (internal service auth)' })
  @ApiOkResponse({ type: NotificationPreferenceResponseDto })
  async internalNotificationPrefs(
    @Query('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<NotificationPreferenceRecord> {
    return this.notifications.get(customerId);
  }

  /**
   * PAR-05. The same sweep, reachable by the scheduler.
   *
   * FR-091 was built, tested, made idempotent per customer per year — and wired to
   * nothing. The route below it is SUPER_ADMIN-only, i.e. it needs a human's JWT, and
   * scripts/scheduler/sweep.sh authenticates with `x-internal-key`. So no birthday point
   * has ever been granted in production, and nothing complained: there is no screen whose
   * absence anybody feels.
   *
   * `ok` is the J7 verdict. False only when the round accomplished nothing AND something
   * went wrong — a sweep on a day with no birthdays is a working sweep, and a round that
   * granted forty and lost one is too. `disabled` (no LOYALTY_SERVICE_URL) is a failure:
   * the round could not do its job and every candidate went un-stamped.
   */
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('profile/internal/birthday-rewards')
  @ApiOperation({ summary: 'Grant birthday points to today’s birthday customers (scheduler, internal service auth, FR-091)' })
  @ApiOkResponse({ type: BirthdaySweepResultDto })
  async runBirthdayRewardsInternal(): Promise<BirthdayRewardResultDto & { ok: boolean }> {
    // The adapter authenticates system-to-system with the internal key and ignores this
    // argument; there is no JWT on a cron tick to pass through.
    const result = await this.profiles.runBirthdayRewards('');
    return { ...result, ok: !result.disabled && !(result.granted === 0 && result.failed > 0) };
  }

  /*
   * PAR-05: the SUPER_ADMIN twin of the sweep above is GONE, deliberately.
   *
   * It was the only route FR-091 had, it needed a human's JWT, and no screen anywhere
   * offered it — which is precisely why no birthday point was ever granted. Keeping it
   * next to a scheduled sweep would leave the same dead door in the wall: nothing calls
   * it, and a manual run cannot recover a missed day anyway (`findBirthdayCandidates`
   * asks for TODAY's birthdays, so yesterday's are gone whatever anybody presses).
   *
   * If ops ever needs a "run it now" button, that is a screen plus this route back — not a
   * route sitting alone waiting for a screen that was never written.
   */

  /*
   * K5.1: CUSTOMER only, and it was nobody-in-particular before.
   *
   * This writes `user.sub` into the CUSTOMER preference table, so a courier toggling a
   * switch in the driver app minted a customer-preference row keyed by a staff account —
   * rows nothing reads (staff pushes deliberately ignore a customer's own mutes, F8) in a
   * table that holds one audience by design. Staff preferences are their own piece of work
   * (O6); until then the guard says who this belongs to.
   */
  @Roles(Role.CUSTOMER)
  @ApiOkResponse({ type: NotificationPreferenceResponseDto })
  @Get('profile/notifications')
  @ApiOperation({ summary: 'Get my notification preferences' })
  async getNotifications(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPreferenceRecord> {
    return this.notifications.get(user.sub);
  }

  @Roles(Role.CUSTOMER)
  @ApiOkResponse({ type: NotificationPreferenceResponseDto })
  @Patch('profile/notifications')
  @ApiOperation({ summary: 'Update my notification preferences' })
  async updateNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationsDto,
  ): Promise<NotificationPreferenceRecord> {
    return this.notifications.update(user.sub, dto);
  }
}
