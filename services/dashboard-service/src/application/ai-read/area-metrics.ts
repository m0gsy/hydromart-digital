import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, depotScopeIds, gridCell1km, gridCellCenter } from '@hydromart/platform';

import { AiAreaSourcesPort, AreaPin } from '../ports/ai-area-sources.port';
import { AiReadSourcesPort } from '../ports/ai-read-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerEnvelope } from './envelope';
import { DOWN, GroupCtx, GroupMetricMeta, NO_SCOPE, OPEN_MONTH_REASON, SMALL_GROUP_REASON, TOO_MANY, fitsOneRead, isOpen, openGroup, sourceSpans } from './group-context';
import { MaskedCell, suppressSmallGroups } from './masking';
import { ReadScopeService } from './scope.service';

/**
 * HD-20c: where the demand is and where it is not served, per kecamatan, kelurahan (BPS codes) or 1 km cell.
 *  - A-01 served demand: distinct named customers with at least one counted order (the customer metrics'
 *    definition: not BATAL, not VOID) in the month, per cell of the order's delivery pin;
 *  - A-02 unserved demand: addresses whose pin lies outside every depot's area, per cell, and per distance
 *    band to the nearest depot. It belongs to no depot, so it is network-wide only.
 * One CLOSED month, from the 8th of the next month, as every people count. A cell of 1 or 2 is held back and
 * so is its smallest neighbour (masking.ts); orders and gallons are published only for a cell that survives.
 * No customer id, address or coordinate ever leaves: a grid cell is published by its id and its centre.
 */
export const AREA_METRICS = {
  'A-01': { unit: 'orang', month: true, oneMonth: true },
  'A-02': { unit: 'alamat', month: true, oneMonth: true },
} as const satisfies Record<string, GroupMetricMeta>;
export type AreaMetricId = keyof typeof AREA_METRICS;
export const AREA_METRIC_IDS = Object.keys(AREA_METRICS) as AreaMetricId[];

export const AREA_LEVELS = ['kecamatan', 'kelurahan', 'grid'] as const;
export type AreaLevel = (typeof AREA_LEVELS)[number];

export const DISTANCE_BANDS = ['0-1', '1-3', '3-5', '5-10', '>10'] as const;
const UNKNOWN = 'tidak diketahui';
const NETWORK_ONLY =
  'Permintaan yang belum terlayani tidak melekat pada satu depot (alamatnya di luar area semua depot); hanya peran yang membaca semua depot dan semua badan hukum yang menjawabnya.';

export interface AreaQuery {
  /** `YYYY-MM`, WIB. */
  month: string;
  level?: string;
}

interface Cell {
  id: string | null;
  label: string | null;
  lat?: number;
  lng?: number;
  people: number;
  orders: number;
  galon: number;
}

const byId = (a: Cell, b: Cell): number => (a.id === null ? 1 : b.id === null ? -1 : a.id.localeCompare(b.id));

/** What names a cell: its code, its name, or for a grid cell its centre. */
const head = (x: Cell) => ({
  id: x.id,
  label: x.id === null ? UNKNOWN : x.label,
  ...(x.lat !== undefined ? { lat: x.lat, lng: x.lng } : {}),
});

/** One cell as published: the numbers only for a cell that was not held back. */
function publish(x: Cell, m: MaskedCell) {
  return {
    ...head(x),
    customers: m.value,
    ...(m.flag ? { flag: m.flag } : {}),
    orders: m.value === null ? null : x.orders,
    galon: m.value === null ? null : x.galon,
  };
}

@Injectable()
export class AreaMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiAreaSources) private readonly sources: AiAreaSourcesPort,
    @Inject(DASHBOARD_TOKENS.AiReadSources) private readonly grants: AiReadSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: AreaQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    const level = (query.level ?? 'kecamatan') as AreaLevel;
    const c = await openGroup(this.scopes, AREA_METRICS, 'wilayah', metricId, user, { period: 'month', date: `${query.month}-01` }, now);
    if (metricId === 'A-02' && !(await this.readsNetwork(user))) return c.held(NETWORK_ONLY);
    if (metricId === 'A-01' && c.scope.spans.length === 0) return c.none(NO_SCOPE);
    if (isOpen(c)) return c.held(OPEN_MONTH_REASON);
    return metricId === 'A-01' ? this.served(c, level) : this.unserved(c, level);
  }

  /** Whether the caller reads every depot and every legal entity (a machine account does). */
  private async readsNetwork(user: AuthenticatedUser): Promise<boolean> {
    if (user.via === 'machine') return true;
    try {
      if (depotScopeIds(user) !== undefined) return false;
    } catch {
      return false;
    }
    const g = await this.grants.aiGrants(user.role);
    return g?.all === true;
  }

  private async served(c: GroupCtx, level: AreaLevel): Promise<AnswerEnvelope> {
    const spans = sourceSpans(c.scope, c.period.timeZone);
    if (!fitsOneRead(spans)) return c.none(TOO_MANY);
    const pins = await this.sources.areaPins(spans);
    if (!pins) return c.none(DOWN);
    if (pins.length === 0) return c.none('Tidak ada pesanan bernama pada bulan ini.');
    const list = await this.cellsOf(pins, level);
    if (!list) return c.none(DOWN);
    const everyone = new Set(pins.map((p) => p.k)).size;
    const m = suppressSmallGroups(
      list.map((x) => ({ key: x.id ?? UNKNOWN, people: x.people })),
      everyone,
    );
    if (m.cells.every((x) => x.flag)) return c.held(SMALL_GROUP_REASON);
    return c.ok(
      { level, cells: list.map((x, i) => publish(x, m.cells[i])), total: m.total },
      'pelanggan per wilayah: orang (akun bernama) dengan paling sedikit satu pesanan bukan BATAL/VOID pada bulan ini di depot yang boleh Anda baca, menurut titik antar pada pesanan itu; seorang yang memesan ke dua wilayah dihitung di keduanya, jadi sel tidak boleh dijumlahkan, hanya total yang benar; pesanan tanpa titik atau di luar peta masuk "tidak diketahui". Pesanan dan galon hanya diberikan untuk sel yang tidak ditahan; sel kurang dari 3 orang ditahan beserta tetangga terkecilnya',
    );
  }

  /** Distinct customers (k), orders and gallons per cell of the level; null when the region source is down. */
  private async cellsOf(pins: readonly AreaPin[], level: AreaLevel): Promise<Cell[] | null> {
    const located = pins.filter((p) => p.lat !== null && p.lng !== null) as (AreaPin & { lat: number; lng: number })[];
    const key = (p: { lat: number | null; lng: number | null }): string => `${p.lat},${p.lng}`;
    const where = new Map<string, { id: string | null; label: string | null }>();
    if (level === 'grid') {
      for (const p of located) where.set(key(p), { id: gridCell1km(p.lat, p.lng), label: null });
    } else {
      const distinct = [...new Map(located.map((p) => [key(p), p])).values()];
      const hits = await this.sources.lookupRegions(distinct.map((p) => ({ lat: p.lat, lng: p.lng })));
      if (!hits) return null;
      distinct.forEach((p, i) => {
        const r = level === 'kecamatan' ? hits[i].kecamatan : hits[i].kelurahan;
        where.set(key(p), r ? { id: r.code, label: r.name } : { id: null, label: null });
      });
    }
    const acc = new Map<string | null, { label: string | null; ks: Set<number>; orders: number; galon: number }>();
    for (const p of pins) {
      const r = where.get(key(p)) ?? { id: null, label: null };
      const a = acc.get(r.id) ?? { label: r.label, ks: new Set<number>(), orders: 0, galon: 0 };
      a.ks.add(p.k);
      a.orders += p.orders;
      a.galon += p.galon;
      acc.set(r.id, a);
    }
    return [...acc.entries()]
      .map(([id, a]): Cell => ({ id, label: a.label, ...(level === 'grid' && id ? gridCellCenter(id) : {}), people: a.ks.size, orders: a.orders, galon: a.galon }))
      .sort(byId);
  }

  private async unserved(c: GroupCtx, level: AreaLevel): Promise<AnswerEnvelope> {
    const s = await this.sources.unservedDemand(c.period.from.slice(0, 7));
    if (!s) return c.none(DOWN);
    const raw: Cell[] =
      level === 'grid'
        ? s.grid.map((g) => ({ id: g.cell, label: null, ...gridCellCenter(g.cell), people: g.count, orders: 0, galon: 0 }))
        : (level === 'kecamatan' ? s.kecamatan : s.kelurahan).map((g) => ({ id: g.code, label: g.name, people: g.count, orders: 0, galon: 0 }));
    const total = raw.reduce((n, x) => n + x.people, 0);
    if (total === 0) return c.none('Tidak ada alamat di luar area depot yang tercatat pada bulan ini.');
    const list = raw.sort(byId);
    const cells = suppressSmallGroups(list.map((x) => ({ key: x.id ?? UNKNOWN, people: x.people })), total);
    const counts = DISTANCE_BANDS.map((band) => ({ key: band, people: s.bands.find((b) => b.band === band)?.count ?? 0 }));
    const bands = suppressSmallGroups(counts, counts.reduce((n, b) => n + b.people, 0));
    return c.ok(
      {
        level,
        cells: list.map((x, i) => ({ ...head(x), addresses: cells.cells[i].value, ...(cells.cells[i].flag ? { flag: cells.cells[i].flag } : {}) })),
        total: cells.total,
        bands: bands.cells.map((b) => ({ band: b.key, addresses: b.value, ...(b.flag ? { flag: b.flag } : {}) })),
        bandsTotal: bands.total,
      },
      'alamat di luar area semua depot aktif: satu baris per alamat yang titiknya disimpan atau dipindah pada bulan ini ke luar area (paling banyak satu per alamat per bulan), tanpa pelanggan dan tanpa alamat; per wilayah menurut titik itu, dan menurut jarak (km) ke depot aktif terdekat. Sel kurang dari 3 alamat ditahan beserta tetangga terkecilnya',
    );
  }
}
