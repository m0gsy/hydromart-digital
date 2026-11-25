import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { MeterRange, MeterVolumePort } from '../../application/ports/meter-volume.port';
import { MeterVolume } from '../../domain/maintenance';
import { DepotConfigService } from '../../config/depot-config.service';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** order-service refuses more ranges than this in one call (its DTO's ArrayMaxSize). */
export const METER_VOLUME_CHUNK = 200;

/**
 * Asks order-service `POST /reports/internal/meter-volume` (internal key), METER_VOLUME_CHUNK
 * ranges at a time. Soft by default: all nulls for a chunk it could not read. `strict` throws 503
 * instead, for the due sweep.
 */
@Injectable()
export class MeterVolumeHttpAdapter implements MeterVolumePort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(MeterVolumeHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async volumes(ranges: readonly MeterRange[], strict = false): Promise<Array<MeterVolume | null>> {
    const out: Array<MeterVolume | null> = [];
    for (let at = 0; at < ranges.length; at += METER_VOLUME_CHUNK) {
      out.push(...(await this.chunk(ranges.slice(at, at + METER_VOLUME_CHUNK), strict)));
    }
    return out;
  }

  private async chunk(ranges: readonly MeterRange[], strict: boolean): Promise<Array<MeterVolume | null>> {
    const { orderServiceUrl, internalServiceKey } = this.config;
    try {
      if (!orderServiceUrl || !internalServiceKey) throw new Error('order-service URL or internal key missing');
      const res = await fetch(`${orderServiceUrl}/api/v1/reports/internal/meter-volume`, {
        method: 'POST',
        headers: { 'x-internal-key': internalServiceKey, 'content-type': 'application/json' },
        body: JSON.stringify({ ranges }),
        signal: AbortSignal.timeout(MeterVolumeHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`order-service responded ${res.status}`);
      const items = ((await res.json()) as { items?: unknown }).items;
      if (!Array.isArray(items) || items.length !== ranges.length) throw new Error('unexpected shape');
      return items.map((r: Record<string, unknown> | null) =>
        r && isNum(r.m3) && isNum(r.readingDays) && isNum(r.spanDays)
          ? { m3: r.m3, readingDays: r.readingDays, spanDays: r.spanDays }
          : null,
      );
    } catch (e) {
      this.logger.warn(`meter volume unreadable: ${(e as Error).message}`);
      if (strict) throw new ServiceUnavailableException('The meter volume could not be read; retry');
      return ranges.map(() => null);
    }
  }
}
