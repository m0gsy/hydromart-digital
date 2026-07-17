import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';

import { PushPayload, PushSenderPort } from '../../application/ports/push-sender.port';
import { WebPushSubscriptionRecord } from '../../application/ports/push.repository';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Web Push transport (RFC 8291 + VAPID RFC 8292) via the `web-push` library. Blank VAPID
 * keys disable it (no-op) so the service still boots and stores notifications / sends
 * WhatsApp — push is purely additive. Never throws (contract of PushSenderPort).
 */
@Injectable()
export class WebPushSenderAdapter implements PushSenderPort {
  private readonly logger = new Logger(WebPushSenderAdapter.name);
  private readonly enabled: boolean;

  constructor(config: CrmConfigService) {
    const { publicKey, privateKey, subject } = config.vapid;
    this.enabled = Boolean(publicKey && privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } else {
      this.logger.warn('VAPID keys not set; web push disabled (notifications still stored).');
    }
  }

  async send(
    sub: WebPushSubscriptionRecord,
    payload: PushPayload,
  ): Promise<{ ok: boolean; gone?: boolean }> {
    if (!this.enabled) return { ok: false };
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410 = the browser dropped this subscription; caller prunes it.
      if (status === 404 || status === 410) return { ok: false, gone: true };
      this.logger.warn(
        `Web push to ${sub.endpoint.slice(0, 40)}… failed: ${status ?? (e as Error).message}`,
      );
      return { ok: false };
    }
  }
}
