import { Injectable } from '@nestjs/common';

import { BroadcastDeliveryPort } from '../../application/ports/broadcast-delivery.port';
import { NotificationService } from '../../application/services/notification.service';
import { NotificationEvent } from '../../domain/notification-event';

/**
 * Campaign delivery over the notification path: an inbox row, plus best-effort push.
 *
 * Thin on purpose — `NotificationService.notify` already owns the row, the push fan-out and
 * the "push must never fail the notification" rule. All this adds is the BROADCAST event,
 * whose template is a passthrough because staff authored the whole message.
 */
@Injectable()
export class InboxBroadcastDelivery implements BroadcastDeliveryPort {
  constructor(private readonly notifications: NotificationService) {}

  async deliver(phone: string, message: string, customerId: string): Promise<void> {
    await this.notifications.notify(NotificationEvent.BROADCAST, phone, { message }, customerId);
  }
}
