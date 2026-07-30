import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  AssignRoleInput,
  IdentityPort,
  ProvisionStaffInput,
} from '../../application/ports/identity.port';

/**
 * Provisions staff logins through auth-service's internal route. Fails HARD (see the
 * port doc): a thrown error marks that import row failed and no Employee is written,
 * rather than silently creating staff who can never sign in.
 */
@Injectable()
export class IdentityHttpAdapter implements IdentityPort {
  constructor(private readonly config: HrConfigService) {}

  async provisionStaff(input: ProvisionStaffInput): Promise<{ customerId: string }> {
    const body = await this.post<{ id?: string }>('auth/internal/staff', input);
    if (!body.id) {
      throw new ServiceUnavailableException('auth-service tidak mengembalikan id akun');
    }
    return { customerId: body.id };
  }

  async assignRole(input: AssignRoleInput): Promise<void> {
    await this.post('auth/internal/staff/role', input);
  }

  private async post<T>(path: string, input: unknown): Promise<T> {
    const { url, internalKey } = this.config.authService;
    if (!url || !internalKey) {
      throw new ServiceUnavailableException('AUTH_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset');
    }

    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/$/, '')}/api/v1/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify(input),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Gagal menghubungi auth-service: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    if (!res.ok) {
      throw new ServiceUnavailableException(`auth-service menolak permintaan (${res.status})`);
    }
    return (await res.json()) as T;
  }
}
