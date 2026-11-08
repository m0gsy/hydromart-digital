import { Injectable, Logger } from '@nestjs/common';

import { AuditEvent, recordAuditEvent } from '@hydromart/platform';

import { PayoutBankAccountService } from './bank-account.service';
import { CourierPayoutService } from './courier-payout.service';
import { PayoutService } from './payout.service';

const HEADERS = ['reference', 'jenis', 'subjectId', 'jumlah', 'dibuat', 'bank', 'noRekening', 'atasNama'];
const UNVERIFIED = 'BELUM TERVERIFIKASI';

/** RFC 4180 quoting; text starting with a formula character gets a leading apostrophe (HR-22/AAS-07 rule). */
function cell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * PPA-15 — the transfer worklist for finance.
 *
 * The processing queue shows only a MASKED destination, so whoever pays has to open each
 * verified account by hand. This joins every PROCESSING withdrawal (owners and couriers) to
 * the account HQ verified, in one file. An account that is not VERIFIED is never written out:
 * the row says so and finance sends nothing there. Reading full account numbers is a
 * privileged read, so every export leaves an audit entry naming the reader.
 */
@Injectable()
export class HqPayoutExportService {
  private static readonly logger = new Logger(HqPayoutExportService.name);

  constructor(
    private readonly payout: PayoutService,
    private readonly courierPayout: CourierPayoutService,
    private readonly bankAccounts: PayoutBankAccountService,
  ) {}

  async processingCsv(actorId: string): Promise<string> {
    const [owners, couriers] = await Promise.all([
      this.payout.listProcessingWithdrawals(),
      this.courierPayout.listProcessingWithdrawals(),
    ]);
    const queue = [
      ...owners.map((w) => ({ w, jenis: 'OWNER', subjectId: w.franchiseOwnerId })),
      ...couriers.map((w) => ({ w, jenis: 'COURIER', subjectId: w.courierId })),
    ].sort((a, b) => a.w.createdAt.getTime() - b.w.createdAt.getTime());

    const lines: string[] = [HEADERS.join(',')];
    for (const { w, jenis, subjectId } of queue) {
      const account = await this.bankAccounts.mine(subjectId);
      const verified = account?.status === 'VERIFIED' ? account : null;
      lines.push(
        [
          w.reference,
          jenis,
          subjectId,
          w.amount,
          w.createdAt.toISOString(),
          verified ? verified.bankName : UNVERIFIED,
          verified ? verified.accountNumber : '',
          verified ? verified.accountHolder : '',
        ]
          .map(cell)
          .join(','),
      );
    }
    await this.audit({
      action: 'payout.hq.export-processing',
      actorId,
      target: `${queue.length} penarikan`,
      metadata: { rows: queue.length },
    });
    return lines.join('\r\n');
  }

  /** Fail-open like every other audit call; a spy point for tests. */
  protected audit(event: AuditEvent): Promise<void> {
    return recordAuditEvent(
      {
        authServiceUrl: process.env.AUTH_SERVICE_URL ?? '',
        internalServiceKey: process.env.INTERNAL_SERVICE_KEY ?? '',
      },
      event,
      HqPayoutExportService.logger,
    );
  }
}
