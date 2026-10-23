import { Injectable } from '@nestjs/common';

import { StaffPrefsPort } from '../../application/ports/staff-prefs.port';
import { CrmConfigService } from '../../config/crm-config.service';

/**
 * Asks admin-service `POST /notification-prefs/internal/push-disabled` which of these staff
 * accounts have push switched off for a toggle. Internal-key auth: there is no caller, an
 * ops alert is raised by a cron or a stock write.
 *
 * THROWS on any failure (misconfiguration, outage, a refusal) instead of answering an empty
 * set, so the caller can tell "nobody opted out" from "could not find out", and say so in
 * the log. Configuration being absent is a plain empty set: that is a deployment that has not
 * wired the switches, which behaves as it always did.
 */
@Injectable()
export class StaffPrefsHttpAdapter implements StaffPrefsPort {
  private static readonly TIMEOUT_MS = 3000;

  constructor(private readonly config: CrmConfigService) {}

  async pushDisabled(accountIds: string[], toggle: string): Promise<Set<string>> {
    const base = this.config.adminServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key || accountIds.length === 0) return new Set();
    const res = await fetch(`${base}/api/v1/notification-prefs/internal/push-disabled`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify({ accountIds, toggle }),
      signal: AbortSignal.timeout(StaffPrefsHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`admin-service responded ${res.status}`);
    const body = (await res.json()) as { disabled?: unknown };
    return new Set(
      Array.isArray(body.disabled)
        ? body.disabled.filter((i): i is string => typeof i === 'string')
        : [],
    );
  }
}
