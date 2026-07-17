export interface HealthProbeResult {
  /** 'up' when the service answered a 2xx health check, else 'down'. */
  status: 'up' | 'down';
  /** Round-trip latency in milliseconds. */
  latencyMs: number;
  /** HTTP status code returned, or null when the service was unreachable. */
  httpStatus: number | null;
}

/**
 * Probes a single service's health endpoint. Implementations MUST NOT throw — an
 * unreachable or failing service is reported as { status: 'down' }, never an exception,
 * so one bad service never breaks the whole roll-up (13b: degrade gracefully per-service).
 */
export interface HealthProbePort {
  probe(baseUrl: string): Promise<HealthProbeResult>;
}
