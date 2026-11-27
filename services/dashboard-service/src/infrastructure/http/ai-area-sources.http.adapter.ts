import { Injectable, Logger } from '@nestjs/common';

import { AiAreaSourcesPort, AreaPin, RegionHit, RegionRef, UnservedCell, UnservedSummary } from '../../application/ports/ai-area-sources.port';
import { SourceSpan } from '../../application/ports/ai-customer-sources.port';
import { DashboardConfigService } from '../../config/dashboard-config.service';

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const GRID = /^-?\d+:-?\d+$/;

/** customer-service takes at most this many pins per lookup call (MAX_LOOKUP_POINTS there). */
export const LOOKUP_CHUNK = 1000;

const ref = (v: unknown): RegionRef | null | undefined =>
  v === null ? null : isObj(v) && typeof v.code === 'string' && typeof v.name === 'string' ? { code: v.code, name: v.name } : undefined;

/**
 * HD-20c: reads the pins, the regions and the unserved demand with the internal key. Coordinates travel
 * in memory only (never logged: a failure logs the path and the status). Any failure, an unwired
 * service, or a shape it does not recognise is null.
 */
@Injectable()
export class AiAreaSourcesHttpAdapter implements AiAreaSourcesPort {
  private static readonly TIMEOUT_MS = 15000;
  private readonly logger = new Logger(AiAreaSourcesHttpAdapter.name);

  constructor(private readonly config: DashboardConfigService) {}

  private async call(url: string, body?: unknown): Promise<unknown | null> {
    const where = url.split('?')[0];
    try {
      const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-internal-key': this.config.internalServiceKey,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(AiAreaSourcesHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`${where} answered ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (error) {
      this.logger.warn(`${where} unreachable: ${(error as Error).message}`);
      return null;
    }
  }

  async areaPins(spans: readonly SourceSpan[]): Promise<AreaPin[] | null> {
    const b = await this.call(`${this.config.orderServiceUrl}/api/v1/reports/internal/area-points`, { spans });
    if (!isObj(b) || !Array.isArray(b.points)) return null;
    const rows = b.points as unknown[];
    const fine = rows.every(
      (r) =>
        isObj(r) &&
        isCount(r.k) &&
        isCount(r.orders) &&
        isCount(r.galon) &&
        ((r.lat === null && r.lng === null) || (isNum(r.lat) && isNum(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180)),
    );
    return fine ? (rows as AreaPin[]) : null;
  }

  async lookupRegions(points: readonly { lat: number; lng: number }[]): Promise<RegionHit[] | null> {
    const base = this.config.customerServiceUrl;
    if (!base) return null;
    const out: RegionHit[] = [];
    for (let i = 0; i < points.length; i += LOOKUP_CHUNK) {
      const chunk = points.slice(i, i + LOOKUP_CHUNK);
      const b = await this.call(`${base}/api/v1/customers/internal/regions/lookup`, { points: chunk });
      if (!isObj(b) || !Array.isArray(b.points) || b.points.length !== chunk.length) return null;
      for (const r of b.points as unknown[]) {
        const kecamatan = isObj(r) ? ref(r.kecamatan) : undefined;
        const kelurahan = isObj(r) ? ref(r.kelurahan) : undefined;
        if (!isObj(r) || kecamatan === undefined || kelurahan === undefined || typeof r.gridCell !== 'string' || !GRID.test(r.gridCell)) return null;
        out.push({ kecamatan, kelurahan, gridCell: r.gridCell });
      }
    }
    return out;
  }

  async unservedDemand(month: string): Promise<UnservedSummary | null> {
    const base = this.config.customerServiceUrl;
    if (!base) return null;
    const b = await this.call(`${base}/api/v1/customers/internal/unserved-demand?month=${encodeURIComponent(month)}`);
    if (!isObj(b) || !Array.isArray(b.kecamatan) || !Array.isArray(b.kelurahan) || !Array.isArray(b.grid) || !Array.isArray(b.bands)) return null;
    const cells = (list: unknown[]): UnservedCell[] | null => {
      const ok = list.every((r) => isObj(r) && (r.code === null || typeof r.code === 'string') && (r.name === null || typeof r.name === 'string') && isCount(r.count));
      return ok ? (list as UnservedCell[]) : null;
    };
    const kecamatan = cells(b.kecamatan);
    const kelurahan = cells(b.kelurahan);
    const gridOk = (b.grid as unknown[]).every((r) => isObj(r) && typeof r.cell === 'string' && GRID.test(r.cell) && isCount(r.count));
    const bandsOk = (b.bands as unknown[]).every((r) => isObj(r) && typeof r.band === 'string' && isCount(r.count));
    return kecamatan && kelurahan && gridOk && bandsOk
      ? { kecamatan, kelurahan, grid: b.grid as UnservedSummary['grid'], bands: b.bands as UnservedSummary['bands'] }
      : null;
  }
}
