import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser, localDayKey } from '@hydromart/platform';

import {
  AiStockSourcesPort,
  FORECAST_HISTORY_DAYS,
  FORECAST_HORIZON_DAYS,
  MeterDayRow,
  StockLossRow,
} from '../ports/ai-stock-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerEnvelope, belumAda, ok } from './envelope';
import { PeriodQuery, ResolvedPeriod, parsePeriod } from './period';
import { ReadScope, ReadScopeService } from './scope.service';
import { DEPOTS_PER_READ, depotsOn, plusDays, stretchesOf } from './stretches';

/**
 * HD-6 H4, the stock group of the metric dictionary (section 3.7). `now` = about the present
 * moment only: the answer's period is today (WIB), whatever period was sent. No metric here counts people,
 * so none needs group masking; the envelope's personal-data guard still runs on every answer.
 */
export const STOCK_METRICS = {
  'S-01': { unit: 'unit, baris', now: true },
  'S-02': { unit: 'unit, Rp' },
  'S-03': { unit: 'unit, Rp' },
  'S-04': { unit: 'liter, galon, Rp, persen' },
  'S-05': { unit: 'Rp', now: true },
  'S-06': { unit: 'Rp', now: true },
} as const satisfies Record<string, { unit: string; now?: boolean }>;
export type StockMetricId = keyof typeof STOCK_METRICS;
export const STOCK_METRIC_IDS = Object.keys(STOCK_METRICS) as StockMetricId[];

const DOWN = 'Sumber datanya sedang tidak bisa dibaca; coba lagi nanti.';
const NO_DEPOT_NOW = 'Tidak ada depot yang boleh Anda baca hari ini.';
/** The longest a meter history read may be (order-service refuses more). */
const METER_DAYS_PER_READ = 92;
/** Most one-depot reads a single answer will make; past it the answer is "belum ada", not a partial sum. */
const MAX_DEPOT_READS = 300;

class TooManyReads extends Error {}

const sum = <T>(rows: readonly T[], pick: (r: T) => number): number => rows.reduce((s, r) => s + pick(r), 0);
const rp = (n: number): number => Math.round(n);
const r2 = (n: number): number => Math.round(n * 100) / 100;
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Units, value and what could not be priced, per item type and in all. */
function lossValue(rows: readonly StockLossRow[]) {
  const byType: Record<string, { units: number; valueIdr: number | null; unpricedUnits: number }> = {};
  for (const r of rows) {
    const cell = (byType[r.itemType] ??= { units: 0, valueIdr: null, unpricedUnits: 0 });
    cell.units += r.units;
    cell.unpricedUnits += r.unpricedUnits;
    if (r.valueIdr !== null) cell.valueIdr = (cell.valueIdr ?? 0) + r.valueIdr;
  }
  const cells = Object.values(byType);
  const priced = cells.filter((c) => c.valueIdr !== null);
  return {
    byType,
    units: sum(cells, (c) => c.units),
    // Null only when something was counted and nothing could be priced; an empty period is a real 0.
    valueIdr: priced.length === 0 && cells.some((c) => c.units !== 0) ? null : rp(sum(priced, (c) => c.valueIdr ?? 0)),
    unpricedUnits: sum(cells, (c) => c.unpricedUnits),
  };
}

@Injectable()
export class StockMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiStockSources) private readonly sources: AiStockSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    if (!Object.prototype.hasOwnProperty.call(STOCK_METRICS, metricId)) {
      throw new NotFoundException('Metrik stok ini tidak ada di kamus.');
    }
    const id = metricId as StockMetricId;
    const meta: { unit: string; now?: boolean } = STOCK_METRICS[id];
    // A metric about NOW is read over today (WIB) whatever period was asked: the period a caller sends
    // is still validated (a nonsense one is a 400), but the answer's period, scope and number are
    // today's. Reading the scope over the asked month would leave out a depot that only joined later.
    if (meta.now && (query.period !== undefined || query.from !== undefined || query.to !== undefined || query.date !== undefined)) {
      parsePeriod(query, now);
    }
    const period = meta.now ? parsePeriod({ period: 'day' }, now) : parsePeriod(query, now);
    const scope = await this.scopes.resolve(user, period);
    const base = { metricId: id, period, scope: scope.echo, unit: meta.unit, asOf: now };
    const none = (reason: string) => belumAda(base, reason);
    if (scope.spans.length === 0) return none('Tidak ada depot yang boleh Anda baca pada periode ini.');
    try {
      return await this.compute(id, { period, scope, today: localDayKey(now, period.timeZone), base, none });
    } catch (error) {
      if (error instanceof TooManyReads) {
        return none('Terlalu banyak depot untuk dihitung satu per satu dalam satu jawaban; persempit cakupan atau periode.');
      }
      throw error;
    }
  }

  private compute(id: StockMetricId, c: Ctx): Promise<AnswerEnvelope> {
    switch (id) {
      case 'S-01':
        return this.position(c);
      case 'S-02':
      case 'S-03':
        return this.losses(id, c);
      case 'S-04':
        return this.meter(c);
      case 'S-05':
        return this.openPurchases(c);
      default:
        return this.forecast(c);
    }
  }

  /** Reads a many-depot source once per 100 depots and pools the rows; null if any read fails. */
  private async chunked<T>(depotIds: readonly string[], read: (ids: readonly string[]) => Promise<T[] | null>): Promise<T[] | null> {
    const out: T[] = [];
    for (let i = 0; i < depotIds.length; i += DEPOTS_PER_READ) {
      const rows = await read(depotIds.slice(i, i + DEPOTS_PER_READ));
      if (!rows) return null;
      out.push(...rows);
    }
    return out;
  }

  /** Reads a one-depot source ten at a time; null if any read fails. */
  private async each<J, T>(jobs: readonly J[], read: (job: J) => Promise<T | null>): Promise<T[] | null> {
    if (jobs.length > MAX_DEPOT_READS) throw new TooManyReads();
    const out: T[] = [];
    for (let i = 0; i < jobs.length; i += 10) {
      const part = await Promise.all(jobs.slice(i, i + 10).map(read));
      if (part.some((p) => p === null)) return null;
      out.push(...(part as T[]));
    }
    return out;
  }

  /** Depots readable today, for the metrics about now. */
  private nowDepots(c: Ctx): string[] {
    return depotsOn(c.scope, c.today);
  }

  private async position(c: Ctx): Promise<AnswerEnvelope> {
    const depots = this.nowDepots(c);
    if (depots.length === 0) return c.none(NO_DEPOT_NOW);
    const rows = await this.chunked(depots, (ids) => this.sources.position(ids));
    if (!rows) return c.none(DOWN);
    const availableByType: Record<string, number> = {};
    for (const r of rows) for (const t of r.byType) availableByType[t.itemType] = (availableByType[t.itemType] ?? 0) + t.availableUnits;
    return ok(
      { ...c.base, label: 'posisi saat ini, baris tersembunyi tidak dihitung; menipis = tersedia paling banyak stok minimum (hanya bila minimum diisi), habis = tersedia 0 atau kurang' },
      {
        depots: depots.length,
        lines: sum(rows, (r) => r.lines),
        lowLines: sum(rows, (r) => r.lowLines),
        outLines: sum(rows, (r) => r.outLines),
        availableByType,
        byDepot: rows.map((r) => ({ depotId: r.depotId, lines: r.lines, lowLines: r.lowLines, outLines: r.outLines })),
      },
    );
  }

  private async losses(id: 'S-02' | 'S-03', c: Ctx): Promise<AnswerEnvelope> {
    const rows: StockLossRow[] = [];
    for (const st of stretchesOf(c.scope, c.period)) {
      const part = await this.chunked(st.depotIds, (ids) => (id === 'S-03' ? this.sources.wastage(ids, st.range) : this.sources.opname(ids, st.range)));
      if (!part) return c.none(DOWN);
      rows.push(...part);
    }
    const label =
      id === 'S-03'
        ? 'barang rusak atau hilang (penyesuaian stok minus) dan galon kembali rusak, tanpa galon yang dipinjamkan; nilai = harga beli terakhir pada tanggal kejadian; unit tanpa harga beli tidak masuk nilai'
        : 'hasil hitung dikurangi stok sistem, minus = kurang; selisih yang ditolak HQ tidak dihitung, tetapi yang masih menunggu persetujuan HQ termasuk dan bisa berubah bila ditolak; nilai = harga beli terakhir pada tanggal hitung; unit tanpa harga beli tidak masuk nilai';
    return ok({ ...c.base, label }, lossValue(rows));
  }

  /** The water meter over the days each depot was readable, one history read per depot and 92 days. */
  private async meter(c: Ctx): Promise<AnswerEnvelope> {
    const jobs: { depotId: string; from: string; to: string }[] = [];
    for (const s of c.scope.spans) {
      for (let from = s.from; from <= s.to; from = plusDays(from, METER_DAYS_PER_READ)) {
        const to = plusDays(from, METER_DAYS_PER_READ - 1);
        jobs.push({ depotId: s.depotId, from, to: to < s.to ? to : s.to });
      }
    }
    const chunks = await this.each(jobs, (j) => this.sources.meterDays(j.depotId, j.from, j.to));
    if (!chunks) return c.none(DOWN);
    // Only days the meter was closed can be compared with sales; the others say nothing about the water.
    const days = chunks.flat().filter((d): d is MeterDayRow & { meterLiters: number; varianceLiters: number } => d.meterLiters !== null && d.varianceLiters !== null);
    if (days.length === 0) return c.none('Belum ada meteran tutup yang dicatat pada periode ini.');
    const unpriced = days.filter((d) => d.varianceIdr === null && d.varianceLiters !== 0).length;
    // RO recovery over the period = water out / raw water in, weighted by litres (not a mean of daily
    // percentages): only days that metered the raw water too, so both sides cover the same days.
    const metered = days.filter((d) => d.sourceLiters !== null && d.sourceLiters > 0);
    const sourceLiters = sum(metered, (d) => d.sourceLiters ?? 0);
    return ok(
      {
        ...c.base,
        label:
          'air keluar = (meteran tutup - buka) x 1.000 liter; selisih = air keluar - air terjual dari pesanan bukan BATAL/VOID; rupiah = galon selisih x harga jual rata-rata per galon hari itu; hanya hari dengan meteran tutup; rendemen RO = air keluar / air sumber pada hari yang air sumbernya juga dicatat, dibobot liter',
      },
      {
        daysWithReading: days.length,
        meterLiters: r2(sum(days, (d) => d.meterLiters)),
        soldLiters: r2(sum(days, (d) => d.soldLiters)),
        varianceLiters: r2(sum(days, (d) => d.varianceLiters)),
        varianceGallons: r2(sum(days, (d) => d.varianceGallons ?? 0)),
        // A day with variance but no gallon sold has no price: a total would undercount, so it is held back.
        varianceIdr: unpriced > 0 ? null : rp(sum(days, (d) => d.varianceIdr ?? 0)),
        daysWithoutPrice: unpriced,
        roYieldPct: sourceLiters > 0 ? r1((sum(metered, (d) => d.meterLiters) / sourceLiters) * 100) : null,
      },
    );
  }

  private async openPurchases(c: Ctx): Promise<AnswerEnvelope> {
    const depots = this.nowDepots(c);
    if (depots.length === 0) return c.none(NO_DEPOT_NOW);
    const rows = await this.chunked(depots, (ids) => this.sources.openPurchases(ids));
    if (!rows) return c.none(DOWN);
    return ok(
      { ...c.base, label: 'barang yang masih ditunggu pada PO terkirim: (jumlah pesan - diterima) x harga, baris yang ditutup kurang dengan alasan tidak dihitung, ongkir tidak termasuk; posisi saat ini' },
      { orders: sum(rows, (r) => r.orders), valueIdr: rp(sum(rows, (r) => r.valueIdr)) },
    );
  }

  /** The sales forecast: always a forecast, for the days after today whatever period was asked. */
  private async forecast(c: Ctx): Promise<AnswerEnvelope> {
    const depots = this.nowDepots(c);
    if (depots.length === 0) return c.none(NO_DEPOT_NOW);
    const rows = await this.each(depots, (d) => this.sources.salesForecast(d));
    if (!rows) return c.none(DOWN);
    const predictedDaily = Array.from({ length: FORECAST_HORIZON_DAYS }, (_, i) => rp(sum(rows, (r) => r.predictedDaily[i])));
    return ok(
      {
        ...c.base,
        label: `PERKIRAAN omzet ${FORECAST_HORIZON_DAYS} hari ke depan dari hari ini, dari riwayat ${FORECAST_HISTORY_DAYS} hari; bukan fakta, dan periode yang ditanyakan tidak mengubahnya`,
      },
      { horizonDays: FORECAST_HORIZON_DAYS, historyDays: FORECAST_HISTORY_DAYS, predictedRevenueIdr: rp(sum(predictedDaily, (v) => v)), predictedDaily },
    );
  }
}

interface Ctx {
  period: ResolvedPeriod;
  scope: ReadScope;
  today: string;
  base: { metricId: string; period: ResolvedPeriod; scope: ReadScope['echo']; unit: string; asOf: Date };
  none: (reason: string) => AnswerEnvelope<never>;
}
