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

  async provisionEmployees(
    inputs: readonly ProvisionEmployeeInput[],
  ): Promise<{ index: number; ok: boolean; message: string | null }[]> {
    if (inputs.length === 0) return [];
    const body = await this.post('employees/internal/provision-many', { rows: inputs });
    const results = (body as { results?: unknown })?.results;
    if (!Array.isArray(results)) {
      // A 200 with the wrong shape is not a success. Saying so beats reporting every row
      // as provisioned when nothing in hr-service actually answered the question.
      throw new ServiceUnavailableException('hr-service mengembalikan hasil yang tidak dikenali.');
    }
    return results as { index: number; ok: boolean; message: string | null }[];
  }

  async setEmployeeActive(authSubjectId: string, active: boolean): Promise<void> {
    await this.post('employees/internal/status', { authSubjectId, active });
  }

  async anonymiseEmployee(authSubjectId: string): Promise<void> {
    await this.post('employees/internal/anonymise', { authSubjectId });
  }

  private async post(path: string, input: unknown): Promise<unknown> {
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
    // Most callers ignore this; the batch provision reads per-row verdicts out of it. A body
    // that will not parse is treated as no body, not as a failure — the write did land, and
    // only the one caller that needs a body checks the shape of what it got.
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
