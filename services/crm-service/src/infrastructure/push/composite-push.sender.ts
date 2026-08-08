import { Injectable } from '@nestjs/common';

import { PushPayload, PushSenderPort } from '../../application/ports/push-sender.port';
import { WebPushSubscriptionRecord } from '../../application/ports/push.repository';
import { FcmSenderAdapter } from '../fcm/fcm.sender.adapter';
import { WebPushSenderAdapter } from '../webpush/web-push.sender.adapter';

/**
 * One customer can be signed in on a browser and on the Android app at once, and the
 * fan-out in `PushService` does not know or care which is which. This picks the transport
 * per subscription from the `fcm:` prefix on the endpoint.
 *
 * Sending a browser subscription to FCM (or the reverse) does not fail loudly — it fails
 * as a 400 that looks like every other 400 — so the routing lives here rather than being
 * inferred inside either adapter.
 */
@Injectable()
export class CompositePushSender implements PushSenderPort {
  constructor(
    private readonly webPush: WebPushSenderAdapter,
    private readonly fcm: FcmSenderAdapter,
  ) {}

  send(
    sub: WebPushSubscriptionRecord,
    payload: PushPayload,
  ): Promise<{ ok: boolean; gone?: boolean }> {
    const sender = FcmSenderAdapter.owns(sub.endpoint) ? this.fcm : this.webPush;
    return sender.send(sub, payload);
  }
}
