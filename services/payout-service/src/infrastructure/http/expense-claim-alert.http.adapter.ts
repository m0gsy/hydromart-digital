import { Injectable, Logger } from '@nestjs/common';

import {
  ExpenseClaimAlert,
  ExpenseClaimAlertPort,
} from '../../application/ports/expense-claim-alert.port';
import { PayoutConfigService } from '../../config/payout-config.service';

const idr = (n: number): string => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/** The words a reviewer reads, not the enum (CA-2-49 made the same fix on the screen). */
const CATEGORY_WORDS: Record<string, string> = {
  FUEL: 'BBM',
  PARKING_TOLL: 'parkir/tol',
  VEHICLE_REPAIR: 'perbaikan kendaraan',
  OTHER: 'lainnya',
};

@Injectable()
export class ExpenseClaimAlertHttpAdapter implements ExpenseClaimAlertPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ExpenseClaimAlertHttpAdapter.name);

  constructor(private readonly config: PayoutConfigService) {}

  async submitted(alert: ExpenseClaimAlert): Promise<void> {
    const { crmServiceUrl, internalServiceKey, opsAlertPhone } = this.config;
    if (!crmServiceUrl || !internalServiceKey || !opsAlertPhone) {
      this.logger.debug('Expense-claim alert skipped (alerting disabled)');
      return;
    }
    try {
      const res = await fetch(`${crmServiceUrl}/api/v1/notifications/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          event: 'EXPENSE_CLAIM_SUBMITTED',
          phone: opsAlertPhone,
          ...(alert.depotId ? { depotId: alert.depotId } : {}),
          vars: {
            claimId: alert.claimId,
            amount: idr(alert.amount),
            category: CATEGORY_WORDS[alert.category] ?? alert.category.toLowerCase(),
          },
        }),
        signal: AbortSignal.timeout(ExpenseClaimAlertHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`crm-service responded ${res.status}`);
    } catch (e) {
      this.logger.warn(`Expense-claim alert for ${alert.claimId} skipped: ${(e as Error).message}`);
    }
  }
}
