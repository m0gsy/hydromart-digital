import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { InternalAuthGuard, Public, Role, Roles } from '@hydromart/platform';

import { NotificationService } from '../application/services/notification.service';
import { NotificationDto, SendNotificationDto } from './dto/notification.dto';

// Fired by upstream services (order-service) forwarding the acting fulfilment staff
// member's token; SUPER_ADMIN can trigger manually. Not a customer-facing endpoint.
// NOTE (MVP ceiling, same as sibling coordination endpoints): trusts the forwarded
// staff token — proper hardening is service-to-service auth.
const TRIGGER_ROLES = [
  Role.DEPOT_OPERATOR,
  Role.DEPOT_MANAGER,
  Role.DRIVER,
  Role.SUPER_ADMIN,
] as const;

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Roles(...TRIGGER_ROLES)
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
  @Public()
  @UseGuards(InternalAuthGuard)
  @ApiSecurity('internal-key')
  @Post('internal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a system-triggered notification (internal service auth)' })
  async sendInternal(@Body() dto: SendNotificationDto): Promise<NotificationDto> {
    return this.dispatch(dto);
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
