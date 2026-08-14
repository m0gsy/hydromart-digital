import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, Can, CurrentUser, InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { NotificationService } from '../application/services/notification.service';
import {
  NotificationDto,
  OpsNotificationDto,
  OpsReadAllResultDto,
  OpsReadResultDto,
  PurgeNotificationsDto,
  SendNotificationDto,
} from './dto/notification.dto';
import { Purge3ResponseDto } from './dto/responses.generated.dto';

// Fired by upstream services (order-service) forwarding the acting fulfilment staff
// member's token; SUPER_ADMIN can trigger manually. Not a customer-facing endpoint.
// NOTE (MVP ceiling, same as sibling coordination endpoints): trusts the forwarded
// staff token — proper hardening is service-to-service auth.
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  // Customer-facing inbox: the caller's own notification feed, newest first.
  @Roles(Role.CUSTOMER)
  @Get('me')
  @ApiOperation({ summary: "List the current customer's notifications" })
  @ApiOkResponse({ type: NotificationDto, isArray: true })
  async listMine(@CurrentUser() user: AuthenticatedUser): Promise<NotificationDto[]> {
    const records = await this.notifications.listForCustomer(user.sub);
    return records.map((record) => NotificationDto.from(record));
  }

  // Staff operational feed (PRD 10d): recent operational alerts (low stock, …), each
  // carrying the caller's own read receipt — reads are per staff member, not shared.
  @Can('opsNotif')
  @Get('ops')
  @ApiOperation({ summary: 'List recent operational notifications (staff ops center)' })
  @ApiOkResponse({ type: OpsNotificationDto, isArray: true })
  async listOps(@CurrentUser() user: AuthenticatedUser): Promise<OpsNotificationDto[]> {
    const records = await this.notifications.listOpsFeed(user.sub);
    return records.map((record) => OpsNotificationDto.fromOps(record));
  }

  @Can('opsNotif')
  @Post('ops/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one operational notification read (idempotent)' })
  @ApiOkResponse({ type: OpsReadResultDto })
  async markOpsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OpsReadResultDto> {
    const readAt = await this.notifications.markOpsRead(id, user.sub);
    if (!readAt) throw new NotFoundException('Operational notification not found');
    return { readAt };
  }

  @Can('opsNotif')
  @Post('ops/read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the whole operational feed read (idempotent)' })
  @ApiOkResponse({ type: OpsReadAllResultDto })
  async markAllOpsRead(@CurrentUser() user: AuthenticatedUser): Promise<OpsReadAllResultDto> {
    return { marked: await this.notifications.markAllOpsRead(user.sub) };
  }

  @ApiOkResponse({ type: NotificationDto })
  @Can('orderFulfilment')
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send an event-triggered WhatsApp notification (FR-093/FR-094)' })
  async send(@Body() dto: SendNotificationDto): Promise<NotificationDto> {
    return this.dispatch(dto);
  }

  // Service-to-service path for system-triggered events with no end-user token
  // (e.g. auth-service registration welcome, payment webhooks). Authenticated by the
  // shared INTERNAL_SERVICE_KEY, not a JWT. @Public() bypasses the global JWT guard;
  // InternalAuthGuard is then the sole (fail-closed) auth.
  @ApiOkResponse({ type: NotificationDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a system-triggered notification (internal service auth)' })
  async sendInternal(@Body() dto: SendNotificationDto): Promise<NotificationDto> {
    return this.dispatch(dto);
  }

  // Retention sweep driven by admin-service (M23-21 enforcement). Same internal-key
  // auth as the send path — never reachable with an end-user token.
  @ApiOkResponse({ type: Purge3ResponseDto })
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal/purge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete notification history older than the cutoff (internal)' })
  purge(@Body() dto: PurgeNotificationsDto): Promise<{ deleted: number }> {
    return this.notifications.purgeOlderThan(new Date(dto.cutoff));
  }

  private async dispatch(dto: SendNotificationDto): Promise<NotificationDto> {
    const record = await this.notifications.notify(
      dto.event,
      dto.phone,
      dto.vars ?? {},
      dto.customerId ?? null,
    );
    return NotificationDto.from(record);
  }
}
