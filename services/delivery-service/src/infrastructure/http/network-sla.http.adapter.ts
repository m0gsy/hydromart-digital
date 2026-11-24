import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { NetworkSlaPort } from '../../application/ports/network-sla.port';

/**
 * Reads the network SLA policy from admin-service with the shared internal key. Fails to
 * null, never throws: a delivery must complete even when admin is down, and the caller then
 * falls back to this service's own threshold. Cached briefly because every completion asks.
 */
@Injectable()
export class NetworkSlaHttpAdapter implements NetworkSlaPort {
  private static readonly TIMEOUT_MS = 3000;
  private static readonly TTL_MS = 60_000;
  private readonly logger = new Logger(NetworkSlaHttpAdapter.name);
  private cached: { value: number; at: number } | null = null;

  constructor(private readonly config: DeliveryConfigService) {}

  async thresholdMinutes(): Promise<number | null> {
    const { adminServiceUrl, internalServiceKey } = this.config;
    if (!adminServiceUrl || !internalServiceKey) return null;
    if (this.cached && Date.now() - this.cached.at < NetworkSlaHttpAdapter.TTL_MS) {
      return this.cached.value;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NetworkSlaHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(`${adminServiceUrl}/api/v1/sla-policy`, {
        headers: { 'x-internal-key': internalServiceKey },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`admin-service responded ${res.status}`);
      const body = (await res.json()) as { onTimeThresholdMinutes?: unknown };
      const value = body.onTimeThresholdMinutes;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
      this.cached = { value, at: Date.now() };
      return value;
    } catch (error) {
      this.logger.warn(`Network SLA policy read failed: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
