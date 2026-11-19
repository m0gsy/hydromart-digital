import { Injectable, Logger } from '@nestjs/common';

import { DestinationBrakesPort } from '../../application/ports/destination-brakes.port';
import { CrmConfigService } from '../../config/crm-config.service';

export const LEAVE_SCREEN_FLAG = 'notifications.leave_screen';

/**
 * Reads admin-service's public flag route (the one the apps read) FAIL-CLOSED: no URL, an
 * outage, a refusal, a body it cannot read or a key it does not list all mean "held".
 *
 * Not platform's httpFeatureFlagReader: that one is fail-OPEN by design (a missing URL or an
 * unknown key reads as on), which for a brake is exactly backwards.
 *
 * Cached for a minute, answers and failures alike: a leave request is not a hot path, but a
 * burst of them should not each wait on admin-service, and a released brake reaching every
 * new notification within a minute is soon enough.
 */
@Injectable()
export class DestinationBrakesHttpAdapter implements DestinationBrakesPort {
  // Short: the read sits in front of the row write (the stored destination needs it), and
  // admin-service is on the same network. Held is the answer to anything slower.
  private static readonly TIMEOUT_MS = 1500;
  static readonly TTL_MS = 60_000;
  private readonly logger = new Logger(DestinationBrakesHttpAdapter.name);
  // The promise, so a burst on an expired cache shares one read instead of each waiting on it.
  private cached: { at: number; live: Promise<boolean> } | null = null;

  constructor(private readonly config: CrmConfigService) {}

  async leaveScreenLive(): Promise<boolean> {
    const now = Date.now();
    if (!this.cached || now - this.cached.at >= DestinationBrakesHttpAdapter.TTL_MS) {
      this.cached = { at: now, live: this.read() };
    }
    return this.cached.live;
  }

  private async read(): Promise<boolean> {
    const base = this.config.adminServiceUrl;
    if (!base) return false;
    try {
      const res = await fetch(`${base}/api/v1/feature-flags/public`, {
        signal: AbortSignal.timeout(DestinationBrakesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`admin-service responded ${res.status}`);
      const flags = (await res.json()) as unknown;
      return (
        Array.isArray(flags) &&
        flags.some(
          (f) =>
            typeof f === 'object' &&
            f !== null &&
            (f as { key?: unknown }).key === LEAVE_SCREEN_FLAG &&
            (f as { enabled?: unknown }).enabled === true,
        )
      );
    } catch (e) {
      this.logger.warn(`${LEAVE_SCREEN_FLAG} unreadable, holding the brake: ${(e as Error).message}`);
      return false;
    }
  }
}
