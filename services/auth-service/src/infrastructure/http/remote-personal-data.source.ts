import { Provider } from '@nestjs/common';

import {
  PERSONAL_DATA_SOURCES,
  PersonalDataSource,
} from '../../application/ports/personal-data-source.port';
import type { ErasureSubject } from '../../application/ports/erasure-executor.port';
import { AuthConfigService } from '../../config/auth-config.service';

/** The services that hold a copy of the person beside customer-service's address book. */
export const REMOTE_EXPORTS = [
  {
    section: 'subscriptions',
    envKey: 'ORDER_SERVICE_URL',
    path: '/api/v1/subscriptions/internal/pdp-export',
  },
  { section: 'deliveries', envKey: 'DELIVERY_SERVICE_URL', path: '/api/v1/proofs/internal/pdp-export' },
] as const;

/** Same transport as RemoteErasureExecutor: POST the subject with the internal key. */
export class RemotePersonalDataSource implements PersonalDataSource {
  private static readonly TIMEOUT_MS = 10_000;

  constructor(
    readonly section: string,
    private readonly baseUrl: string,
    private readonly path: string,
    private readonly internalKey: string,
  ) {}

  async collect(subject: ErasureSubject): Promise<unknown> {
    if (!this.baseUrl || !this.internalKey) throw new Error(`${this.section}: not configured`);
    const response = await fetch(`${this.baseUrl}${this.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': this.internalKey },
      body: JSON.stringify(subject),
      signal: AbortSignal.timeout(RemotePersonalDataSource.TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${this.section}: owner responded ${response.status}`);
    return response.json();
  }
}

export const personalDataSourcesProvider: Provider = {
  provide: PERSONAL_DATA_SOURCES,
  inject: [AuthConfigService],
  useFactory: (config: AuthConfigService): PersonalDataSource[] =>
    REMOTE_EXPORTS.map(
      (d) =>
        new RemotePersonalDataSource(
          d.section,
          config.serviceUrl(d.envKey),
          d.path,
          config.internalServiceKey,
        ),
    ),
};
