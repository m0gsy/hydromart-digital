import { Inject, Injectable, Logger } from '@nestjs/common';

import { NotificationEvent, renderMessage, templateFor } from '../../domain/notification-event';
import { NotificationStatus } from '../../domain/notification-status';
import { NotificationRecord, NotificationRepository } from '../ports/notification.repository';
import { WhatsappBroadcastPort } from '../ports/whatsapp-broadcast.port';
import { CRM_TOKENS } from '../tokens';

/**
 * Event-triggered transactional WhatsApp notifications (FR-093/FR-094). Fired by upstream
 * services (order-service) on lifecycle changes. Every attempt is recorded to the audit
 * trail — a delivery failure is stored as FAILED, never thrown, since the notification is
 * a side-effect of an already-committed business action.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(CRM_TOKENS.NotificationRepository) private readonly repo: NotificationRepository,
    @Inject(CRM_TOKENS.WhatsappBroadcast) private readonly whatsapp: WhatsappBroadcastPort,
  ) {}

  async notify(
    event: NotificationEvent,
    phone: string,
    vars: Record<string, string>,
    customerId: string | null = null,
  ): Promise<NotificationRecord> {
    const message = renderMessage(templateFor(event), vars);
    const result = await this.whatsapp.send(phone, message);
    if (!result.ok) {
      this.logger.warn(`Notification ${event} to ${phone} failed: ${result.error ?? 'unknown'}`);
    }
    return this.repo.record({
      event,
      customerId,
      phone,
      message,
      status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      error: result.ok ? null : result.error ?? 'unknown error',
    });
  }
}
