import { Injectable } from '@nestjs/common';

import { HealthProbePort, HealthProbeResult } from '../../application/ports/health-probe.port';

/**
 * Probes a peer service's public liveness endpoint over HTTP (Design 13b). Every service
 * exposes GET /api/v1/health (see each service's HealthController + the compose
 * healthchecks). Never throws: a timeout, network error, or non-2xx all resolve to
 * { status: 'down' } with the measured latency, so one bad service can't fake "up" or
 * break the roll-up.
 */
@Injectable()
export class HealthProbeHttpAdapter implements HealthProbePort {
  private static readonly TIMEOUT_MS = 3000;
  private static readonly HEALTH_PATH = '/api/v1/health';

  async probe(baseUrl: string): Promise<HealthProbeResult> {
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}${HealthProbeHttpAdapter.HEALTH_PATH}`, {
        signal: AbortSignal.timeout(HealthProbeHttpAdapter.TIMEOUT_MS),
      });
      return {
        status: res.ok ? 'up' : 'down',
        latencyMs: Date.now() - start,
        httpStatus: res.status,
      };
    } catch {
      // Timeout / connection refused / DNS failure: unreachable, never faked "up".
      return { status: 'down', latencyMs: Date.now() - start, httpStatus: null };
    }
  }
}
