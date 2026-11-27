import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { StaffRosterPort } from '../../application/ports/staff-roster.port';
import { CustomerConfigService } from '../../config/customer-config.service';

/** auth-service's internal "active staff ids at one depot" route. Fails HARD (see the port). */
@Injectable()
export class StaffRosterHttpAdapter implements StaffRosterPort {
  private readonly logger = new Logger(StaffRosterHttpAdapter.name);
  private static readonly TIMEOUT_MS = 5000;

  constructor(private readonly config: CustomerConfigService) {}

  async staffIdsForDepot(depotId: string): Promise<string[]> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      throw new ServiceUnavailableException('AUTH_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }
    let res: Response;
    try {
      res = await fetch(`${base.replace(/\/$/, '')}/api/v1/auth/internal/staff/depot/${depotId}`, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(StaffRosterHttpAdapter.TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`auth-service unreachable (${err instanceof Error ? err.name : 'unknown'})`);
      throw new ServiceUnavailableException('Gagal menghubungi auth-service');
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(`auth-service tidak mengirim daftar staf depot (${res.status})`);
    }
    const body = (await res.json()) as { ids?: string[] };
    return body.ids ?? [];
  }
}
