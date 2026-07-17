import { Inject, Injectable, Logger } from '@nestjs/common';

import { PushPayload, PushSenderPort } from '../ports/push-sender.port';
import {
  PushSubscriptionRepository,
  SaveSubscriptionData,
  WebPushSubscriptionRecord,
} from '../ports/push.repository';
import { CRM_TOKENS } from '../tokens';

/** Browser Web Push (design 7b transport): device registration + best-effort fan-out. */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(CRM_TOKENS.PushSubscriptionRepository)
    private readonly subs: PushSubscriptionRepository,
    @Inject(CRM_TOKENS.PushSender) private readonly sender: PushSenderPort,
  ) {}

  subscribe(customerId: string, data: Omit<SaveSubscriptionData, 'customerId'>): Promise<WebPushSubscriptionRecord> {
    return this.subs.upsert({ customerId, ...data });
  }

  unsubscribe(endpoint: string): Promise<void> {
    return this.subs.deleteByEndpoint(endpoint);
  }

  /**
   * Push a payload to every device a customer registered. Best-effort: dead endpoints
   * (404/410) are pruned; other failures are swallowed (the notification is already stored).
   */
  async sendToCustomer(customerId: string, payload: PushPayload): Promise<void> {
    const subs = await this.subs.listForCustomer(customerId);
    await Promise.all(
      subs.map(async (sub) => {
        const res = await this.sender.send(sub, payload);
        if (res.gone) {
          await this.subs.deleteByEndpoint(sub.endpoint);
          this.logger.log(`Pruned expired push subscription for customer ${customerId}`);
        }
      }),
    );
  }
}
