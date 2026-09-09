import { Injectable, Logger } from '@nestjs/common';

import { PhotoLinkPort } from '../../application/ports/photo-link.port';
import { PayoutConfigService } from '../../config/payout-config.service';

/**
 * CA-4-49, step 3 — asks delivery-service to sign a receipt it stores.
 *
 * The receipt is uploaded through the courier app into delivery-service's bucket, so this
 * service holds the URL and none of the credentials. The bucket is private, so the stored
 * URL opens nothing on its own.
 *
 * **Fails SOFT**, the opposite of the fraud-block adapter and for a reason worth stating: a
 * reviewer's claim list must still load when delivery-service is down or unconfigured. A
 * missing link means the screen says there is no receipt to show; an exception here would
 * mean the money screen itself refuses to open.
 */
@Injectable()
export class PhotoLinkHttpAdapter implements PhotoLinkPort {
  private static readonly TIMEOUT_MS = 4000;
  private readonly logger = new Logger(PhotoLinkHttpAdapter.name);

  constructor(private readonly config: PayoutConfigService) {}

  async signedUrl(storedUrl: string): Promise<string | null> {
    const base = this.config.deliveryServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return null;
    try {
      const res = await fetch(`${base}/api/v1/proofs/photo-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ url: storedUrl }),
        signal: AbortSignal.timeout(PhotoLinkHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`delivery-service answered ${res.status} for a receipt link`);
        return null;
      }
      const body = (await res.json()) as { url?: string | null };
      return body.url ?? null;
    } catch (error) {
      this.logger.warn(`Could not mint a receipt link: ${(error as Error).message}`);
      return null;
    }
  }
}
