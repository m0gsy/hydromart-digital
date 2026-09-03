import { Injectable, Logger } from '@nestjs/common';

import { AccountSuspensionPort } from '../../application/ports/account-suspension.port';
import { AdminConfigService } from '../../config/admin-config.service';

/**
 * Suspends the account behind a fraud flag, through auth-service's internal route.
 *
 * CA-2-05: the fraud queue's "Blokir" set the flag's own status and nothing else, so an
 * operator pressed it, the row turned red, and the customer kept ordering. auth-service
 * already refuses a SUSPENDED account at sign-in; this is the wire that asks it to.
 *
 * **Fails CLOSED**, which is the opposite of most outbound calls in this service. The audit
 * trail may lose an entry without harm; a fraud block may not. A flag that reads BLOCKED
 * while the account still signs in is precisely the state being fixed, so every failure
 * here throws and the flag stays OPEN.
 */
@Injectable()
export class AccountSuspensionHttpAdapter implements AccountSuspensionPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(AccountSuspensionHttpAdapter.name);

  constructor(private readonly config: AdminConfigService) {}

  async setActive(customerId: string, active: boolean): Promise<void> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      // Not a silent skip: without this call the block does not happen, and the caller
      // must not record one. An unconfigured environment is a refusal, not a pass.
      this.logger.error(
        `Cannot ${active ? 'reinstate' : 'suspend'} ${customerId}: no auth URL/key`,
      );
      throw new Error('auth-service is not configured; the account was not changed');
    }
    const res = await fetch(`${base}/api/v1/auth/internal/customers/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify({ customerId, active }),
      signal: AbortSignal.timeout(AccountSuspensionHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`auth-service responded ${res.status} — the account was not changed`);
    }
  }
}
