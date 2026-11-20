import { Injectable, Logger } from '@nestjs/common';

import { AccountNamesPort } from '../../application/ports/account-names.port';
import { OrderConfigService } from '../../config/order-config.service';

/** auth-service's internal profile lookup; fail-soft by contract (the port never throws). */
@Injectable()
export class AccountNamesHttpAdapter implements AccountNamesPort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(AccountNamesHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async nameOf(accountId: string): Promise<string | null> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return null;
    try {
      const res = await fetch(`${base}/api/v1/auth/internal/customers/by-ids`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ ids: [accountId] }),
        signal: AbortSignal.timeout(AccountNamesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`auth-service responded ${res.status}`);
      const rows = (await res.json()) as unknown;
      const row = Array.isArray(rows)
        ? (rows as { id?: unknown; fullName?: unknown }[]).find((r) => r?.id === accountId)
        : undefined;
      return typeof row?.fullName === 'string' && row.fullName.trim() ? row.fullName : null;
    } catch (e) {
      this.logger.warn(`name of ${accountId} unreadable: ${(e as Error).message}`);
      return null;
    }
  }
}
