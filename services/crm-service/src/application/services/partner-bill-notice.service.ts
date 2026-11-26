import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { NotificationEvent } from '../../domain/notification-event';
import { NotificationService } from './notification.service';

export interface PartnerBillNotice {
  billId: string;
  monthLabel: string;
  legalEntityName: string;
  totalIdr: number;
  bank: { bankName: string; bankAccountNumber: string; bankAccountHolder: string };
  recipientIds: string[];
}

const CONCURRENCY = 5;
const rupiah = (n: number): string => `Rp${Math.round(n).toLocaleString('id-ID')}`;

/**
 * HD-23: one in-app notice (and email) per franchise owner for an approved royalty bill. The
 * numbers are payout-service's own, sent here and written straight into the text: nothing passes
 * n8n. The dedupe key is the memory, so Finance pressing "Setujui" again after a failure files
 * nothing twice: one row per (bill, recipient).
 */
@Injectable()
export class PartnerBillNoticeService {
  private readonly logger = new Logger(PartnerBillNoticeService.name);

  constructor(private readonly notifications: NotificationService) {}

  /** THROWS 503 when a recipient could not be told; rows already filed stay, a retry is safe. */
  async run(notice: PartnerBillNotice): Promise<{ recipients: number; notified: number }> {
    const vars: Record<string, string> = {
      month: notice.monthLabel,
      entity: notice.legalEntityName,
      total: rupiah(notice.totalIdr),
      bank: notice.bank.bankName,
      number: notice.bank.bankAccountNumber,
      holder: notice.bank.bankAccountHolder,
      billId: notice.billId,
    };
    let notified = 0;
    let failed = 0;
    for (let at = 0; at < notice.recipientIds.length; at += CONCURRENCY) {
      await Promise.all(
        notice.recipientIds.slice(at, at + CONCURRENCY).map(async (recipient) => {
          try {
            const filed = await this.notifications.notifyOnce(
              NotificationEvent.PARTNER_BILL,
              '',
              vars,
              recipient,
              null,
              `partner-bill:${notice.billId}:${recipient}`,
            );
            if (filed.created) notified += 1;
          } catch (e) {
            failed += 1;
            this.logger.warn(`partner bill notice for ${recipient} failed: ${(e as Error).message}`);
          }
        }),
      );
    }
    if (failed > 0) throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry`);
    return { recipients: notice.recipientIds.length, notified };
  }
}
