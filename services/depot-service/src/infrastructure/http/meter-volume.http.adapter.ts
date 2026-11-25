import { Injectable, Logger } from '@nestjs/common';

import { MeterRange, MeterVolumePort } from '../../application/ports/meter-volume.port';
import { MeterVolume } from '../../domain/maintenance';
import { DepotConfigService } from '../../config/depot-config.service';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Asks order-service `POST /reports/internal/meter-volume` (internal key). Fails soft: all nulls. */
@Injectable()
export class MeterVolumeHttpAdapter implements MeterVolumePort {
  private static readonly TIMEOUT_MS = 8000;
  private readonly logger = new Logger(MeterVolumeHttpAdapter.name);

  constructor(private readonly config: DepotConfigService) {}

  async volumes(ranges: readonly MeterRange[]): Promise<Array<MeterVolume | null>> {
    const none = ranges.map(() => null);
    const { orderServiceUrl, internalServiceKey } = this.config;
    if (ranges.length === 0 || !orderServiceUrl || !internalServiceKey) return none;
    try {
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
      return none;
    }
  }
}
