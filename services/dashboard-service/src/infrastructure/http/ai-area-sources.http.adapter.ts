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
/** Lookup chunks in flight at once. */
export const LOOKUP_PARALLEL = 4;

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

  private async call(url: string, deadline: number, body?: unknown): Promise<unknown | null> {
    const where = url.split('?')[0];
    const left = deadline - Date.now();
    if (left <= 0) {
      this.logger.warn(`${where} not called: the overall deadline has passed`);
      return null;
    }
    try {
      const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-internal-key': this.config.internalServiceKey,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(Math.min(AiAreaSourcesHttpAdapter.TIMEOUT_MS, left)),
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

  async areaPins(spans: readonly SourceSpan[], deadline: number): Promise<AreaPin[] | null> {
    const b = await this.call(`${this.config.orderServiceUrl}/api/v1/reports/internal/area-points`, deadline, { spans });
    if (!isObj(b) || !Array.isArray(b.points)) return null;
    const rows = b.points as unknown[];
    // A half pin (only lat or only lng) is no pin; a number that is not a coordinate is a source we do not understand.
    const inRange = (v: unknown, max: number): boolean => v === null || (isNum(v) && Math.abs(v) <= max);
    const fine = rows.every((r) => isObj(r) && isCount(r.k) && isCount(r.orders) && isCount(r.galon) && inRange(r.lat, 90) && inRange(r.lng, 180));
    return fine
      ? (rows as AreaPin[]).map((r) => (r.lat === null || r.lng === null ? { ...r, lat: null, lng: null } : r))
      : null;
  }

  private async lookupChunk(base: string, chunk: readonly { lat: number; lng: number }[], deadline: number): Promise<RegionHit[] | null> {
    const b = await this.call(`${base}/api/v1/customers/internal/regions/lookup`, deadline, { points: chunk });
    if (!isObj(b) || !Array.isArray(b.points) || b.points.length !== chunk.length) return null;
    const out: RegionHit[] = [];
    for (const r of b.points as unknown[]) {
      const kecamatan = isObj(r) ? ref(r.kecamatan) : undefined;
      const kelurahan = isObj(r) ? ref(r.kelurahan) : undefined;
      if (!isObj(r) || kecamatan === undefined || kelurahan === undefined || typeof r.gridCell !== 'string' || !GRID.test(r.gridCell)) return null;
      out.push({ kecamatan, kelurahan, gridCell: r.gridCell });
    }
    return out;
  }

  async lookupRegions(points: readonly { lat: number; lng: number }[], deadline: number): Promise<RegionHit[] | null> {
    const base = this.config.customerServiceUrl;
    if (!base) return null;
    const chunks: { lat: number; lng: number }[][] = [];
    for (let i = 0; i < points.length; i += LOOKUP_CHUNK) chunks.push(points.slice(i, i + LOOKUP_CHUNK));
    const out: RegionHit[] = [];
    for (let i = 0; i < chunks.length; i += LOOKUP_PARALLEL) {
      const done = await Promise.all(chunks.slice(i, i + LOOKUP_PARALLEL).map((c) => this.lookupChunk(base, c, deadline)));
      for (const d of done) {
        if (!d) return null;
        out.push(...d);
      }
    }
    return out;
  }

  async unservedDemand(month: string, deadline: number): Promise<UnservedSummary | null> {
    const base = this.config.customerServiceUrl;
    if (!base) return null;
    const b = await this.call(`${base}/api/v1/customers/internal/unserved-demand?month=${encodeURIComponent(month)}`, deadline);
    if (!isObj(b) || !Array.isArray(b.kecamatan) || !Array.isArray(b.kelurahan) || !Array.isArray(b.grid) || !Array.isArray(b.bands)) return null;
    const cells = (list: unknown[]): UnservedCell[] | null => {
      const ok = list.every((r) => isObj(r) && (r.code === null || typeof r.code === 'string') && (r.name === null || typeof r.name === 'string') && isCount(r.count));
      return ok ? (list as UnservedCell[]) : null;
    };
    const kecamatan = cells(b.kecamatan);
    const kelurahan = cells(b.kelurahan);
    // a kelurahan row always names its kecamatan: without it a row with no kelurahan code could not be grouped
    const parented = (b.kelurahan as { kecamatan?: unknown }[]).every((r) => typeof r.kecamatan === 'string');
    const gridOk = (b.grid as unknown[]).every((r) => isObj(r) && typeof r.cell === 'string' && GRID.test(r.cell) && isCount(r.count));
    const bandsOk = (b.bands as unknown[]).every((r) => isObj(r) && typeof r.band === 'string' && isCount(r.count));
    return kecamatan && kelurahan && parented && gridOk && bandsOk
      ? { kecamatan, kelurahan, grid: b.grid as UnservedSummary['grid'], bands: b.bands as UnservedSummary['bands'] }
      : null;
  }
}
