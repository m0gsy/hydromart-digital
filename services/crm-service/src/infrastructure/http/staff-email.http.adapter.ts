import { Injectable } from '@nestjs/common';

import { StaffEmail, StaffEmailPort } from '../../application/ports/staff-email.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * admin-service `POST notification-prefs/internal/email`, internal key, like the push switches
 * beside it. Unconfigured (no admin URL or key) is a quiet no-op, as for those switches; any
 * other unhappy answer THROWS for the caller to log.
 */
@Injectable()
export class StaffEmailHttpAdapter implements StaffEmailPort {
  // admin answers once its SMTP sends are done. Nobody waits on this call (the notification is
  // already filed), so the limit is generous: a slow mail server is not a refusal.
  private static readonly TIMEOUT_MS = 30_000;

  constructor(private readonly config: CrmConfigService) {}

  async send(email: StaffEmail): Promise<void> {
    const base = this.config.adminServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) return;
    const res = await fetch(`${base}/api/v1/notification-prefs/internal/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(StaffEmailHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`admin-service responded ${res.status}`);
  }
}
