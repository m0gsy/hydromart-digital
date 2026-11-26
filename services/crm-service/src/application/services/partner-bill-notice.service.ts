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

export interface PartnerBillVoidNotice {
  billId: string;
  monthLabel: string;
  legalEntityName: string;
  reason: string;
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
  run(notice: PartnerBillNotice): Promise<{ recipients: number; notified: number }> {
    return this.fanOut(
      NotificationEvent.PARTNER_BILL,
      'partner-bill',
      notice.billId,
      notice.recipientIds,
      {
        month: notice.monthLabel,
        entity: notice.legalEntityName,
        total: rupiah(notice.totalIdr),
        bank: notice.bank.bankName,
        number: notice.bank.bankAccountNumber,
        holder: notice.bank.bankAccountHolder,
        billId: notice.billId,
      },
    );
  }

  /** HD-23: a sent bill was withdrawn. One row per (bill, owner), told once even if void is retried. */
  runVoid(notice: PartnerBillVoidNotice): Promise<{ recipients: number; notified: number }> {
    return this.fanOut(
      NotificationEvent.PARTNER_BILL_VOID,
      'partner-bill-void',
      notice.billId,
      notice.recipientIds,
      { month: notice.monthLabel, entity: notice.legalEntityName, reason: notice.reason, billId: notice.billId },
    );
  }

  private async fanOut(
    event: NotificationEvent,
    keyPrefix: string,
    billId: string,
    recipientIds: string[],
    vars: Record<string, string>,
  ): Promise<{ recipients: number; notified: number }> {
    let notified = 0;
    let failed = 0;
    for (let at = 0; at < recipientIds.length; at += CONCURRENCY) {
      await Promise.all(
        recipientIds.slice(at, at + CONCURRENCY).map(async (recipient) => {
          try {
            const filed = await this.notifications.notifyOnce(event, '', vars, recipient, null, `${keyPrefix}:${billId}:${recipient}`);
            if (filed.created) notified += 1;
          } catch (e) {
            failed += 1;
            this.logger.warn(`${keyPrefix} notice for ${recipient} failed: ${(e as Error).message}`);
          }
        }),
      );
    }
    if (failed > 0) throw new ServiceUnavailableException(`${failed} recipient(s) could not be told; retry`);
    return { recipients: recipientIds.length, notified };
  }
}
