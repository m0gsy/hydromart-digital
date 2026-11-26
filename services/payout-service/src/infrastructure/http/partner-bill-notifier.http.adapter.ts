import { Injectable, Logger } from '@nestjs/common';

import {
  PartnerBillNotice,
  PartnerBillNotifier,
} from '../../application/ports/partner-bill-sources.port';
import { PayoutConfigService } from '../../config/payout-config.service';
import { PartnerBillSourceUnavailableError } from '../../domain/errors.partner-bill';

/**
 * HD-23: asks crm-service to file the bill in each owner's inbox and email. The numbers are
 * computed here and sent here: nothing passes n8n. crm dedupes per (bill, owner), so a retry
 * after a failure re-sends nothing that already went. FAILS CLOSED: an approval whose notice
 * could not be filed is not marked sent, so Finance can press it again.
 */
@Injectable()
export class PartnerBillNotifierHttpAdapter implements PartnerBillNotifier {
  private static readonly TIMEOUT_MS = 15000;
  private readonly logger = new Logger(PartnerBillNotifierHttpAdapter.name);

  constructor(private readonly config: PayoutConfigService) {}

  async send(notice: PartnerBillNotice): Promise<void> {
    const base = this.config.crmServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new PartnerBillSourceUnavailableError('crm-service');
    try {
      const res = await fetch(`${base}/api/v1/notifications/internal/partner-bill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify(notice),
        signal: AbortSignal.timeout(PartnerBillNotifierHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`answered ${res.status}`);
    } catch (error) {
      this.logger.warn(`partner bill ${notice.billId} notice: ${(error as Error).message}`);
      throw new PartnerBillSourceUnavailableError('crm-service');
    }
  }
}
