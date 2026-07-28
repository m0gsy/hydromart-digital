import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import { IdentityPort, PreRegisterResult } from '../../application/ports/identity.port';

/**
 * Pre-registers imported customers through auth-service's internal route. Fails HARD
 * (unlike the fail-open catalog adapter): the import row is the caller's own write, so
 * an unreachable auth-service must surface as that row failing.
 */
@Injectable()
export class IdentityHttpAdapter implements IdentityPort {
  private static readonly TIMEOUT_MS = 5000;

  constructor(private readonly config: CustomerConfigService) {}

  async preRegisterCustomer(phone: string, fullName?: string): Promise<PreRegisterResult> {
    const base = this.config.authServiceUrl;
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      throw new ServiceUnavailableException('AUTH_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }

    let res: Response;
    try {
      res = await fetch(`${base.replace(/\/$/, '')}/api/v1/auth/internal/customers/pre-register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ phone, fullName }),
        signal: AbortSignal.timeout(IdentityHttpAdapter.TIMEOUT_MS),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Gagal menghubungi auth-service: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    if (!res.ok) {
      throw new ServiceUnavailableException(`auth-service menolak nomor ini (${res.status})`);
    }
    const body = (await res.json()) as Partial<PreRegisterResult>;
    if (!body.customerId || !body.status) {
      throw new ServiceUnavailableException('auth-service tidak mengembalikan identitas');
    }
    return { customerId: body.customerId, status: body.status };
  }
}
