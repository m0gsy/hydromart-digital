import { Inject, Injectable, Logger } from '@nestjs/common';

import { PushPayload, PushSenderPort } from '../ports/push-sender.port';
import {
  PushSubscriptionRepository,
  SaveSubscriptionData,
  WebPushSubscriptionRecord,
} from '../ports/push.repository';
import { CRM_TOKENS } from '../tokens';
import { InvalidPushEndpointError, PushEndpointTakenError } from '../../domain/errors';
import { isAllowedPushEndpoint } from '../../domain/push-endpoint';

/** Browser Web Push (design 7b transport): device registration + best-effort fan-out. */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(CRM_TOKENS.PushSubscriptionRepository)
    private readonly subs: PushSubscriptionRepository,
    @Inject(CRM_TOKENS.PushSender) private readonly sender: PushSenderPort,
  ) {}

  async subscribe(
    customerId: string,
    data: Omit<SaveSubscriptionData, 'customerId'>,
  ): Promise<WebPushSubscriptionRecord> {
    if (!isAllowedPushEndpoint(data.endpoint)) throw new InvalidPushEndpointError();
    /*
     * CRM-5: upsert-by-endpoint handed an existing device to whichever account registered
     * it last, so knowing someone's endpoint was enough to take their phone's notifications
     * over. Moving a Web Push device to another account now needs its keys too — which only
     * the browser holding the subscription has. An FCM row carries no keys; its token is
     * itself the secret, and a shared phone signing in as somebody else must still move.
     */
    const existing = await this.subs.findByEndpoint(data.endpoint);
    const keyed = !!existing?.p256dh;
    if (
      existing &&
      existing.customerId !== customerId &&
      keyed &&
      (existing.p256dh !== data.p256dh || existing.auth !== data.auth)
    ) {
      throw new PushEndpointTakenError();
    }
    return this.subs.upsert({ customerId, ...data });
  }

  /**
   * The endpoint arrives from the caller, so the owner has to come from the token. Without
   * that pairing this deleted by endpoint alone, and any signed-in account could silence
   * another person's phone by replaying an endpoint string.
   */
  unsubscribe(customerId: string, endpoint: string): Promise<void> {
    return this.subs.deleteByEndpoint(endpoint, customerId);
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
          await this.subs.deleteByEndpoint(sub.endpoint, customerId);
          this.logger.log(`Pruned expired push subscription for customer ${customerId}`);
        }
      }),
    );
  }
}
