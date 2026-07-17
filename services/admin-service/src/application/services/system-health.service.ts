import { Inject, Injectable } from '@nestjs/common';

import { AdminConfigService } from '../../config/admin-config.service';
import { HealthProbePort } from '../ports/health-probe.port';
import { ADMIN_TOKENS } from '../tokens';

export interface ServiceHealth {
  name: string;
  status: 'up' | 'down';
  latencyMs: number;
  httpStatus: number | null;
}

export interface SystemHealth {
  services: ServiceHealth[];
  upCount: number;
  total: number;
  checkedAt: string;
}

@Injectable()
export class SystemHealthService {
  constructor(
    private readonly config: AdminConfigService,
    @Inject(ADMIN_TOKENS.HealthProbe) private readonly probe: HealthProbePort,
  ) {}

  /**
   * Fan out to every configured peer service's health endpoint in parallel and return
   * a real per-service roll-up (Design 13b). Each probe fails independently: an
   * unreachable service is reported { status: 'down' }, never faked "operational", and
   * never aborts the roll-up. Results are ordered by the static registry for stable UI.
   */
  async check(): Promise<SystemHealth> {
    const registry = this.config.serviceRegistry();
    const services = await Promise.all(
      registry.map(async ({ name, baseUrl }): Promise<ServiceHealth> => {
        const result = await this.probe.probe(baseUrl);
        return { name, ...result };
      }),
    );
    const upCount = services.filter((s) => s.status === 'up').length;
    return { services, upCount, total: services.length, checkedAt: new Date().toISOString() };
  }
}
