import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { HrDirectoryPort, ProvisionEmployeeInput } from '../../application/ports/hr-directory.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * The hr-service half of a staff invite, over the shared INTERNAL_SERVICE_KEY.
 *
 * Fails CLOSED (see the port doc): an unconfigured URL or a rejected call raises, so an
 * invite either produces both halves of a person or none. Same shape as
 * CustomerDataHttpAdapter — timeout, internal key, no retry: the console can simply be
 * clicked again, and a retry loop here would mint duplicates on a slow hr-service.
 */
@Injectable()
export class HrDirectoryHttpAdapter implements HrDirectoryPort {
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly config: AuthConfigService) {}

  async provisionEmployee(input: ProvisionEmployeeInput): Promise<void> {
    await this.post('employees/internal/provision', input);
  }

  async setEmployeeActive(authSubjectId: string, active: boolean): Promise<void> {
    await this.post('employees/internal/status', { authSubjectId, active });
  }

  async anonymiseEmployee(authSubjectId: string): Promise<void> {
    await this.post('employees/internal/anonymise', { authSubjectId });
  }

  private async post(path: string, input: unknown): Promise<void> {
    const { hrUrl, internalKey } = this.config.hrDirectory;
    if (!hrUrl || !internalKey) {
      throw new ServiceUnavailableException(
        'HR_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset; undangan staf tidak bisa diproses.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HrDirectoryHttpAdapter.TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${hrUrl.replace(/\/$/, '')}/api/v1/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `hr-service tidak terjangkau: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(`hr-service menolak permintaan (${response.status})`);
    }
  }
}
