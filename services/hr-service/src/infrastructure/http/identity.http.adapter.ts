import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { HrConfigService } from '../../config/hr-config.service';
import {
  AssignRoleInput,
  IdentityPort,
  ProvisionManagedStaffInput,
  ProvisionStaffInput,
} from '../../application/ports/identity.port';

/**
 * Provisions staff logins through auth-service's internal route. Fails HARD (see the
 * port doc): a thrown error marks that import row failed and no Employee is written,
 * rather than silently creating staff who can never sign in.
 */
@Injectable()
export class IdentityHttpAdapter implements IdentityPort {
  // Audit F-3: staff provisioning fails HARD, so a hung auth-service used to hang the
  // whole bulk import with no error and no row written. A deadline turns it into a
  // failed row the importer can report.
  private static readonly TIMEOUT_MS = 8_000;

  constructor(private readonly config: HrConfigService) {}

  async provisionStaff(input: ProvisionStaffInput): Promise<{ customerId: string }> {
    return this.provision('auth/internal/staff', input);
  }

  /** The form's route, whose allowlist reaches the supervision chain. See the port doc. */
  async provisionManagedStaff(input: ProvisionManagedStaffInput): Promise<{ customerId: string }> {
    return this.provision('auth/internal/staff/managed', input);
  }

  private async provision(path: string, input: unknown): Promise<{ customerId: string }> {
    const body = await this.post<{ id?: string }>(path, input);
    if (!body.id) {
      throw new ServiceUnavailableException('auth-service tidak mengembalikan id akun');
    }
    return { customerId: body.id };
  }

  async assignRole(input: AssignRoleInput): Promise<void> {
    await this.post('auth/internal/staff/role', input);
  }

  async setStaffActive(customerId: string, active: boolean): Promise<void> {
    await this.post('auth/internal/staff/status', { customerId, active });
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
        signal: AbortSignal.timeout(IdentityHttpAdapter.TIMEOUT_MS),
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
