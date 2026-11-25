import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { can } from '@hydromart/access';
import { AuthenticatedUser, localDayKey } from '@hydromart/platform';

import { AiMoneySourcesPort, DepotMoneyRow, DepotSalesRow, InstantRange, MoneyKind, UnplacedMoney } from '../ports/ai-money-sources.port';
import { DashboardSourcesPort } from '../ports/dashboard-sources.port';
import { DashboardService } from '../services/dashboard.service';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerEnvelope, ditahan, belumAda, ok } from './envelope';
import { PeriodQuery, ResolvedPeriod, parsePeriod } from './period';
import { ReadScope, ReadScopeService, grantedRanges } from './scope.service';
import { splitByDepot, wantsSplit } from './split';
import { DEPOTS_PER_READ, Stretch, stretchesOf } from './stretches';

/**
 * HD-6 H2, the money metrics of the metric dictionary (sections 3.1, 3.3, 3.4). `month` = only
 * defined over one whole calendar month (the P&L is monthly by decision #8).
 *
 * No metric here counts people, so none of them needs group masking; the envelope's personal-data
 * guard still runs on every answer.
 */
export const MONEY_METRICS = {
  'P-01': { unit: 'Rp' },
  'P-02': { unit: 'Rp' },
  'P-03': { unit: 'Rp' },
  'P-04': { unit: 'pesanan' },
  'P-05': { unit: 'Rp' },
  'P-06': { unit: 'pesanan, persen' },
  'P-07': { unit: 'pesanan' },
  'P-08': { unit: 'pesanan, Rp' },
  'P-09': { unit: 'Rp' },
  'P-10': { unit: 'Rp' },
  'P-11': { unit: 'Rp' },
  'P-13': { unit: 'pesanan, Rp' },
  'P-14': { unit: 'Rp' },
  'U-01': { unit: 'Rp' },
  'U-02': { unit: 'Rp, transaksi' },
  'U-03': { unit: 'Rp' },
  'U-04': { unit: 'Rp' },
  'U-05': { unit: 'Rp' },
  'U-06': { unit: 'Rp' },
  'U-07': { unit: 'hari', month: true },
  'L-01': { unit: 'Rp', month: true },
  'L-02': { unit: 'Rp' },
  'L-03': { unit: 'Rp', month: true },
  'L-04': { unit: 'Rp' },
  'L-05': { unit: 'Rp' },
  'L-06': { unit: 'Rp', month: true },
  'L-07': { unit: 'Rp', month: true },
  'L-08': { unit: 'persen', month: true },
  'L-09': { unit: 'Rp', month: true },
} as const satisfies Record<string, { unit: string; month?: boolean }>;
export type MoneyMetricId = keyof typeof MONEY_METRICS;
export const MONEY_METRIC_IDS = Object.keys(MONEY_METRICS) as MoneyMetricId[];

interface Ctx {
  user: AuthenticatedUser;
  period: ResolvedPeriod;
  scope: ReadScope;
  stretches: Stretch[];
  /** Today in WIB, `YYYY-MM-DD`. */
  today: string;
  /** AI-7a: answer per depot (only the plain depot sums honour it). */
  split: boolean;
  ok: <V>(value: V, label?: string) => AnswerEnvelope<V>;
  none: (reason: string) => AnswerEnvelope<never>;
  held: (reason: string) => AnswerEnvelope<never>;
}

/** Whether the stretches, joined where one starts the day after the previous ends, cover `[from, to]` whole. */
function coversWhole(ranges: readonly { from: string; to: string; legalEntityId: string | null }[], from: string, to: string): boolean {
  // A depot that changed legal entity mid-month is two P&Ls, not one: only stretches of ONE entity join up.
  if (new Set(ranges.map((r) => r.legalEntityId)).size > 1) return false;
  const next = (day: string): string => {
    // tz-ok: calendar days held as UTC midnights; the UTC slice IS the calendar day.
    return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); // tz-ok: calendar day
  };
  let reach = from;
  for (const r of [...ranges].sort((a, b) => a.from.localeCompare(b.from))) {
    if (r.from > reach) return false;
    if (r.to >= reach) reach = next(r.to);
    if (reach > to) return true;
  }
  return reach > to;
}

/** Most one-depot reads a single answer will make; past it the answer is "belum ada", not a partial sum. */
const MAX_DEPOT_READS = 300;
const DOWN = 'Sumber datanya sedang tidak bisa dibaca; coba lagi nanti.';
const NO_ORDERS = 'Tidak ada pesanan pada periode ini.';

class TooManyReads extends Error {}

const sum = <T>(rows: readonly T[], pick: (r: T) => number): number => rows.reduce((s, r) => s + pick(r), 0);
const rp = (n: number): number => Math.round(n);
const pct = (part: number, whole: number): number => Math.round((part / whole) * 1000) / 10;

/** Amount and count per key, for a breakdown by method or age. */
function tally(rows: readonly DepotMoneyRow[], key: (r: DepotMoneyRow) => string): Record<string, { amountIdr: number; count: number }> {
  const out: Record<string, { amountIdr: number; count: number }> = {};
  for (const r of rows) {
    const cell = (out[key(r)] ??= { amountIdr: 0, count: 0 });
    cell.amountIdr += r.amountIdr;
    cell.count += r.count;
  }
  return out;
}

@Injectable()
export class MoneyMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiMoneySources) private readonly sources: AiMoneySourcesPort,
    @Inject(DASHBOARD_TOKENS.Sources) private readonly depots: DashboardSourcesPort,
    private readonly dashboard: DashboardService,
  ) {}

  async answer(
    metricId: string,
    user: AuthenticatedUser,
    query: PeriodQuery,
    now: Date = new Date(),
  ): Promise<AnswerEnvelope> {
    if (!Object.prototype.hasOwnProperty.call(MONEY_METRICS, metricId)) {
      throw new NotFoundException('Metrik uang ini tidak ada di kamus.');
    }
    const id = metricId as MoneyMetricId;
    const meta: { unit: string; month?: boolean } = MONEY_METRICS[id];
    const period = parsePeriod(query, now, meta.month ? { whole: 'month' } : {});
    // A named day or week is not a whole month even when it sits inside one, and a named year is twelve of them.
    if (meta.month && (period.unit === 'day' || period.unit === 'week' || period.unit === 'year' || period.from.slice(0, 7) !== period.to.slice(0, 7))) {
      throw new BadRequestException(`${id} hanya untuk satu bulan penuh`);
    }
    const scope = await this.scopes.resolve(user, period);
    const make = (narrowed: ReadScope) => {
      const base = { metricId: id, period, scope: narrowed.echo, unit: meta.unit, asOf: now };
      return {
        ok: <V>(value: V, label?: string) => ok({ ...base, label }, value),
        none: (reason: string) => belumAda(base, reason),
        held: (reason: string) => ditahan(base, reason),
      };
    };
    const ctx: Ctx = { user, period, scope, stretches: stretchesOf(scope, period), today: localDayKey(now, period.timeZone), split: wantsSplit(query), ...make(scope) };
    if (scope.spans.length === 0) return ctx.none('Tidak ada depot yang boleh Anda baca pada periode ini.');
    try {
      return await this.compute(id, ctx, make);
    } catch (error) {
      if (error instanceof TooManyReads) {
        return ctx.none('Terlalu banyak depot untuk dihitung satu per satu dalam satu jawaban; persempit cakupan atau periode.');
      }
      throw error;
    }
  }

  /** Reads a many-depot source once per stretch (and per 100 depots) and pools the rows; null if any read fails. */
  private async pool<T>(
    ctx: Ctx,
    read: (depotIds: readonly string[], range: InstantRange) => Promise<T[] | null>,
  ): Promise<T[] | null> {
    const out: T[] = [];
    for (const st of ctx.stretches) {
      for (let i = 0; i < st.depotIds.length; i += DEPOTS_PER_READ) {
        const rows = await read(st.depotIds.slice(i, i + DEPOTS_PER_READ), st.range);
        if (!rows) return null;
        out.push(...rows);
      }
    }
    return out;
  }

  /** Reads a one-depot source once per (depot, stretch), ten at a time; null if any read fails. */
  private async perDepot<T>(
    ctx: Ctx,
    read: (depotId: string, range: InstantRange) => Promise<T | null>,
  ): Promise<T[] | null> {
    const jobs = ctx.stretches.flatMap((st) => st.depotIds.map((d) => ({ d, range: st.range })));
    if (jobs.length > MAX_DEPOT_READS) throw new TooManyReads();
    const out: T[] = [];
    for (let i = 0; i < jobs.length; i += 10) {
      const part = await Promise.all(jobs.slice(i, i + 10).map((j) => read(j.d, j.range)));
      if (part.some((p) => p === null)) return null;
      out.push(...(part as T[]));
    }
    return out;
  }

  private async compute(id: MoneyMetricId, c: Ctx, make: (s: ReadScope) => Pick<Ctx, 'ok' | 'none' | 'held'>): Promise<AnswerEnvelope> {
    switch (id) {
      case 'P-01':
      case 'P-03':
      case 'P-04':
      case 'P-05':
      case 'P-06':
      case 'P-07':
      case 'P-08':
      case 'P-10':
        return this.sales(id, c);
      case 'P-02':
        return this.refunds(c);
      case 'P-09':
        return this.products(c);
      case 'P-13':
        return this.timeArea(c);
      case 'P-11':
        return c.none('PPN per periode belum dihitung di mana pun; hanya ada per pesanan.');
      case 'U-03':
        return c.none('Piutang pesanan dalam rupiah belum dihitung di mana pun.');
      case 'P-14':
        return c.held('Satu pelanggan adalah kelompok 1 orang; aturan masking menahan angka per pelanggan (kurang dari 3).');
      case 'U-01':
      case 'U-02':
      case 'U-04':
      case 'U-05':
        return this.cash(id, c);
      case 'U-06':
      case 'L-02':
        return this.cashbook(id, c);
      case 'U-07':
        return this.closedDays(c);
      case 'L-04':
      case 'L-05':
        return this.payout(id, c);
      case 'L-09':
        return this.cashFlow(c, make);
      default:
        return this.pnl(id, c, make);
    }
  }

  private async sales(id: MoneyMetricId, c: Ctx): Promise<AnswerEnvelope> {
    const rows = await this.pool(c, (d, r) => this.sources.salesSummary(d, r));
    if (!rows) return c.none(DOWN);
    const revenue = rp(sum(rows, (r) => r.revenueIdr));
    const orders = sum(rows, (r) => r.orders);
    const cancelled = sum(rows, (r) => r.cancelledOrders);
    // AI-7a: the plain sums answer `{ total, byDepot }` when asked; the total is the unsplit answer.
    const val = (total: number, pick: (r: DepotSalesRow) => number, round?: (n: number) => number) =>
      c.split ? splitByDepot(c.scope.echo.depotIds, rows, pick, round) : total;
    switch (id) {
      case 'P-01':
        return c.ok(val(revenue, (r) => r.revenueIdr, rp), 'omzet: nilai yang ditagihkan dari semua pesanan kecuali batal dan void, menurut tanggal pesanan dibuat, sebelum refund, tanpa riwayat impor');
      case 'P-03': {
        const refund = await this.refundTotals(c);
        if (!refund) return c.none(DOWN);
        return c.ok(revenue - refund.counted, 'omzet bersih: omzet dikurangi refund menurut tanggal refund' + MoneyMetricsService.unplacedNote(refund.unplaced));
      }
      case 'P-04':
        return c.ok(val(orders, (r) => r.orders));
      case 'P-05':
        return orders === 0 ? c.none(NO_ORDERS) : c.ok(rp(revenue / orders));
      case 'P-06':
        return orders + cancelled === 0
          ? c.none(NO_ORDERS)
          : c.ok({ cancelled, ratePct: pct(cancelled, orders + cancelled) }, 'batal = pesanan BATAL yang dibuat pada periode; void kasir tidak masuk');
      case 'P-07':
        return c.ok(val(sum(rows, (r) => r.deliveredOrders), (r) => r.deliveredOrders), 'pesanan TERKIRIM atau SELESAI yang dibuat pada periode');
      case 'P-08':
        return orders === 0
          ? c.none(NO_ORDERS)
          : c.ok({
              app: { orders: sum(rows, (r) => r.appOrders), revenueIdr: rp(sum(rows, (r) => r.appRevenueIdr)) },
              counter: { orders: sum(rows, (r) => r.counterOrders), revenueIdr: rp(sum(rows, (r) => r.counterRevenueIdr)) },
            });
      default:
        return c.ok(val(rp(sum(rows, (r) => r.shippingIdr)), (r) => r.shippingIdr, rp), 'ongkir tertagih pada pesanan bukan batal/void; sudah termasuk di omzet');
    }
  }

  /**
   * Money rows of a window, once per stretch and per 100 depots, plus the paid orders with no depot
   * (read network-wide by payment-service, so counted once per stretch, not once per chunk).
   */
  private async readMoney(c: Ctx, kind: MoneyKind): Promise<{ rows: DepotMoneyRow[]; unplaced: UnplacedMoney } | null> {
    const rows: DepotMoneyRow[] = [];
    const unplaced = { orders: 0, amountIdr: 0 };
    for (const st of c.stretches) {
      for (let i = 0; i < st.depotIds.length; i += DEPOTS_PER_READ) {
        const part = await this.sources.money(kind, st.depotIds.slice(i, i + DEPOTS_PER_READ), st.range);
        if (!part) return null;
        rows.push(...part);
        if (i === 0 && part.unplaced) {
          unplaced.orders += part.unplaced.orders;
          unplaced.amountIdr += part.unplaced.amountIdr;
        }
      }
    }
    return { rows, unplaced };
  }

  /** What the answer says about paid orders no depot owns: kept out of every depot's number, but not hidden. */
  private static unplacedNote(u: UnplacedMoney): string {
    return u.orders > 0 ? `; ${u.orders} pesanan tanpa depot (Rp ${rp(u.amountIdr).toLocaleString('id-ID')}) tidak dihitung` : '';
  }

  /** Refunds by refund date, split by whether the order still counts as sales. Null = a source is down. */
  private async refundTotals(c: Ctx): Promise<{ counted: number; notCounted: number; unplaced: UnplacedMoney } | null> {
    const read = await this.readMoney(c, 'refunded');
    if (!read) return null;
    const { rows, unplaced } = read;
    const counting = await this.sources.countingOrders([...new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : [])))]);
    if (!counting) return null;
    let counted = 0;
    let notCounted = 0;
    for (const r of rows) {
      if (r.orderId && counting.has(r.orderId)) counted += r.amountIdr;
      else notCounted += r.amountIdr;
    }
    return { counted: rp(counted), notCounted: rp(notCounted), unplaced };
  }

  private async refunds(c: Ctx): Promise<AnswerEnvelope> {
    const t = await this.refundTotals(c);
    if (!t) return c.none(DOWN);
    return c.ok(
      { refundIdr: t.counted, refundOfCancelledAndVoidOrdersIdr: t.notCounted },
      'refund yang benar-benar dikembalikan menurut tanggal refund, pesanan antar dan kasir, hanya pesanan yang masih dihitung omzet; refund pesanan batal dan void dipisah' + MoneyMetricsService.unplacedNote(t.unplaced),
    );
  }

  private async products(c: Ctx): Promise<AnswerEnvelope> {
    const rows = await this.pool(c, (d, r) => this.sources.productRevenue(d, r));
    if (!rows) return c.none(DOWN);
    const by = new Map<string, { label: string; orders: number; revenueIdr: number }>();
    for (const r of rows) {
      const cell = by.get(r.productId) ?? { label: r.productName, orders: 0, revenueIdr: 0 };
      cell.orders += r.orders;
      cell.revenueIdr += r.revenueIdr;
      by.set(r.productId, cell);
    }
    if (by.size === 0) return c.none(NO_ORDERS);
    const top = [...by.values()]
      .map((p) => ({ ...p, revenueIdr: rp(p.revenueIdr) }))
      .sort((a, b) => b.revenueIdr - a.revenueIdr)
      .slice(0, 10);
    return c.ok(top, '10 produk teratas: nilai baris barang, tanpa ongkir dan tanpa diskon tingkat pesanan, jadi lebih kecil dari omzet');
  }

  private async timeArea(c: Ctx): Promise<AnswerEnvelope> {
    const rows = await this.pool(c, async (d, r) => {
      const t = await this.sources.timeArea(d, r);
      return t ? [t] : null;
    });
    if (!rows) return c.none(DOWN);
    const heat: number[][] = [];
    const weekday = new Map<number, { orders: number; revenueIdr: number }>();
    const area = new Map<string, { label: string; orders: number; revenueIdr: number }>();
    const other = { orders: 0, revenueIdr: 0 };
    for (const t of rows) {
      t.heat.forEach((line, w) => line.forEach((n, h) => ((heat[w] ??= [])[h] = (heat[w][h] ?? 0) + n)));
      for (const w of t.byWeekday) {
        const cell = weekday.get(w.weekday) ?? { orders: 0, revenueIdr: 0 };
        weekday.set(w.weekday, { orders: cell.orders + w.orders, revenueIdr: cell.revenueIdr + w.revenueIdr });
      }
      for (const a of t.byArea) {
        const key = a.area.trim().toLowerCase();
        const cell = area.get(key) ?? { label: a.area, orders: 0, revenueIdr: 0 };
        area.set(key, { label: cell.label, orders: cell.orders + a.orders, revenueIdr: cell.revenueIdr + a.revenueIdr });
      }
      other.orders += t.otherAreas?.orders ?? 0;
      other.revenueIdr += t.otherAreas?.revenueIdr ?? 0;
    }
    if (weekday.size === 0 && area.size === 0) return c.none(NO_ORDERS);
    const byArea = [...area.values()]
      .map((v) => ({ label: v.label, orders: v.orders, revenueIdr: rp(v.revenueIdr) }))
      .sort((a, b) => b.orders - a.orders || a.label.localeCompare(b.label));
    return c.ok(
      {
        heat,
        byWeekday: [...weekday.entries()].sort((a, b) => a[0] - b[0]).map(([w, v]) => ({ weekday: w, orders: v.orders, revenueIdr: rp(v.revenueIdr) })),
        byArea: byArea.slice(0, 10),
        otherAreas: { orders: other.orders + sum(byArea.slice(10), (a) => a.orders), revenueIdr: rp(other.revenueIdr + sum(byArea.slice(10), (a) => a.revenueIdr)) },
      },
      'pesanan bukan batal/void menurut hari dan jam WIB; 10 kota tujuan teratas, sisanya di otherAreas',
    );
  }

  private async cash(id: 'U-01' | 'U-02' | 'U-04' | 'U-05', c: Ctx): Promise<AnswerEnvelope> {
    const kind = id === 'U-02' ? 'pending' : 'collected';
    const read = await this.readMoney(c, kind);
    if (!read) return c.none(DOWN);
    const { rows } = read;
    const note = MoneyMetricsService.unplacedNote(read.unplaced);
    if (id === 'U-01') {
      return c.ok(
        { totalIdr: rp(sum(rows, (r) => r.amountIdr)), byMethod: tally(rows, (r) => r.method) },
        'pembayaran lunas menurut tanggal lunas, dikurangi refund sebesar yang dikembalikan; tunai mencakup COD dan kasir' + note,
      );
    }
    if (id === 'U-02') {
      return c.ok(
        { totalIdr: rp(sum(rows, (r) => r.amountIdr)), count: sum(rows, (r) => r.count), byMethod: tally(rows, (r) => r.method), byAge: tally(rows, (r) => r.age ?? '') },
        'pembayaran MENUNGGU yang dibuat pada periode; umur dalam hari kalender WIB sampai hari ini' + note,
      );
    }
    if (id === 'U-05') {
      const cash = rows.filter((r) => r.channel === 'counter' && r.method === 'CASH');
      const shifts = await this.perDepot(c, (d, r) => this.sources.shiftVariance(d, r));
      return c.ok(
        {
          cashIdr: rp(sum(cash, (r) => r.amountIdr)),
          // A sub-number whose source cannot answer says so inside the answer; it is never left out or 0.
          shiftVariance: shifts
            ? { shifts: sum(shifts, (s) => s.shifts), shortfallIdr: rp(sum(shifts, (s) => s.shortfallIdr)), surplusIdr: rp(sum(shifts, (s) => s.surplusIdr)) }
            : { status: 'belum_ada', reason: DOWN },
        },
        'kas konter: tunai lunas di kasir menurut tanggal lunas, tanpa modal awal; selisih shift = uang dihitung dikurangi seharusnya pada shift yang ditutup dalam periode, kurang dan lebih terpisah' + note,
      );
    }
    const collected = rp(sum(rows.filter((r) => r.channel === 'delivery' && r.method === 'CASH'), (r) => r.amountIdr));
    const dep = await this.perDepot(c, (d, r) => this.sources.codPeriod(d, r));
    if (!dep) return c.none(DOWN);
    return c.ok(
      {
        collectedIdr: collected,
        depositedIdr: rp(sum(dep, (r) => r.depositedIdr)),
        undepositedIdr: rp(sum(dep, (r) => r.undepositedIdr)),
        expectedIdr: rp(sum(dep, (r) => r.expectedIdr)),
        shortfallIdr: rp(sum(dep, (r) => r.shortfallIdr)),
        surplusIdr: rp(sum(dep, (r) => r.surplusIdr)),
      },
      'COD: tertagih = tunai lunas pada pesanan antar menurut tanggal lunas; disetor = setoran kurir terverifikasi menurut tanggal verifikasi; belum disetor = COD pesanan terkirim pada periode yang belum masuk setoran mana pun; seharusnya disetor dengan kurang dan lebih dijumlah terpisah (shortfallIdr, surplusIdr). Tertagih mengikuti depot PESANAN; setoran, seharusnya, kurang dan lebih mengikuti depot SHIFT kurir yang menyetor (satu setoran bisa memuat pesanan depot lain); belum disetor mengikuti depot pengiriman' + note,
    );
  }

  private async cashbook(id: 'U-06' | 'L-02', c: Ctx): Promise<AnswerEnvelope> {
    const rows = await this.perDepot(c, (d, r) => this.sources.cashbookCosts(d, r));
    if (!rows) return c.none(DOWN);
    return id === 'U-06'
      ? c.ok(rp(sum(rows, (r) => r.opexIdr)), 'kas keluar buku kas dikurangi koreksi, tanpa kategori pembelian stok; di luar laba bersih')
      : c.ok(rp(sum(rows, (r) => r.cogsIdr)), 'pembelian diterima: PO selesai diterima pada periode, hanya untuk arus kas');
  }

  private async closedDays(c: Ctx): Promise<AnswerEnvelope> {
    const rows = await this.perDepot(c, (d, r) => this.sources.daysClosed(d, r));
    return rows ? c.ok(sum(rows, (n) => n), 'jumlah hari-depot yang sudah ditutup') : c.none(DOWN);
  }

  private async payout(id: 'L-04' | 'L-05', c: Ctx): Promise<AnswerEnvelope> {
    const rows = await this.pool(c, async (d, r) => {
      const m = await this.depots.payoutCosts([...d], r);
      return m ? [...m.values()] : null;
    });
    if (!rows) return c.none(DOWN);
    return id === 'L-04'
      ? c.ok(rp(sum(rows, (r) => r.commissionIdr)), 'komisi kurir bruto: penghasilan dan insentif yang tercatat pada periode, menurut depot pengantaran')
      : c.ok(rp(sum(rows, (r) => r.expenseClaimIdr)), 'klaim biaya DISETUJUI menurut tanggal ditinjau, depot klaim');
  }

  /** The depots granted for the WHOLE month (a depot that changed entity mid-month is not one P&L), and the narrowed scope. */
  private wholeMonth(c: Ctx, make: (s: ReadScope) => Pick<Ctx, 'ok' | 'none' | 'held'>): { ids: string[]; c: Ctx } {
    const ids = [...new Set(c.scope.spans.map((s) => s.depotId))]
      .filter((d) => coversWhole(grantedRanges(c.scope, d), c.period.from, c.period.to))
      .sort();
    const spans = c.scope.spans.filter((s) => ids.includes(s.depotId));
    const narrowed: ReadScope = {
      spans,
      echo: { depotIds: ids, legalEntityIds: [...new Set(spans.flatMap((s) => (s.legalEntityId ? [s.legalEntityId] : [])))].sort() },
    };
    return { ids, c: { ...c, scope: narrowed, stretches: stretchesOf(narrowed, c.period), ...make(narrowed) } };
  }

  private async cashFlow(c0: Ctx, make: (s: ReadScope) => Pick<Ctx, 'ok' | 'none' | 'held'>): Promise<AnswerEnvelope> {
    const { ids, c } = this.wholeMonth(c0, make);
    if (ids.length === 0) return c.none('Tidak ada depot yang tercakup penuh dalam bulan ini (ada yang pindah badan hukum di tengah bulan).');
    if (!can('payrollRead', c.user.role, ids)) return c.held('Arus kas memuat gaji; hanya peran yang boleh membaca penggajian.');
    const month = c.period.from.slice(0, 7);
    const unfinished = await this.payrollUnfinished(ids, month);
    if (unfinished) return c.none(unfinished);
    const rows = await this.perDepot(c, (d) => this.sources.cashFlow(d, month));
    if (!rows) return c.none(DOWN);
    if (rows.some((r) => r.netCashFlowIdr === null)) return c.none('Arus kas belum lengkap: ada unsur biaya yang belum terbaca (gaji belum digaji atau sumber tidak menjawab).');
    return c.ok(rp(sum(rows, (r) => r.netCashFlowIdr as number)), 'arus kas bersih: (omzet dikurangi refund) dikurangi pembelian diterima, gaji dibayar (hanya bulan yang slipnya sudah disetujui atau dibayar) dan kas keluar; bukan laba');
  }

  /**
   * Owner choice 10A: only APPROVED or PAID payslips count. A depot-month is finished when no slip is
   * DRAFT and as many employees have an APPROVED/PAID slip as the month waits for (employed at any time
   * in it; none expected = nothing to pay). Any depot not finished makes every payroll-bearing number
   * belum_ada. Returns the reason, or null when finished.
   */
  private async payrollUnfinished(ids: readonly string[], month: string): Promise<string | null> {
    const rows = await this.depots.hrSummaryMany([...ids], month);
    if (rows.some((r) => r === null || [r.payrollDraftCount, r.payrollFinalCount, r.payrollExpectedCount].includes(undefined))) {
      return DOWN;
    }
    const open = rows.filter((r) => r!.payrollDraftCount! > 0 || r!.payrollFinalCount! < r!.payrollExpectedCount!);
    return open.length === 0
      ? null
      : `Gaji bulan ini belum selesai: ${open.length} depot masih punya slip DRAFT atau karyawan yang belum punya slip disetujui/dibayar, jadi angka yang memuat gaji belum bisa dijawab.`;
  }

  /** L-01, L-03, L-06, L-07, L-08: the monthly P&L that /hq/pnl already serves, not a second formula. */
  private async pnl(id: MoneyMetricId, c0: Ctx, make: (s: ReadScope) => Pick<Ctx, 'ok' | 'none' | 'held'>): Promise<AnswerEnvelope> {
    const { ids, c } = this.wholeMonth(c0, make);
    if (ids.length === 0) return c.none('Tidak ada depot yang tercakup penuh dalam bulan ini (ada yang pindah badan hukum di tengah bulan).');
    const payVisible = can('payrollRead', c.user.role, ids);
    // Payroll in a depot of a few people is each person's pay: the roles that may not read it get no figure that carries it.
    if ((id === 'L-03' || id === 'L-07' || id === 'L-08') && !payVisible) {
      return c.held('Gaji dan laba bersih hanya untuk peran yang boleh membaca penggajian.');
    }
    if (id === 'L-03' || id === 'L-07' || id === 'L-08') {
      const unfinished = await this.payrollUnfinished(ids, c.period.from.slice(0, 7));
      if (unfinished) return c.none(unfinished);
    }
    const pnl = await this.dashboard.networkPnl(c.period.from.slice(0, 7), '', ids, payVisible);
    const read = new Set(pnl.depots.map((d) => d.depotId));
    if (pnl.sources.depot !== 'ok' || ids.some((d) => !read.has(d))) return c.none(DOWN);
    const t = pnl.totals;
    // The month is still running: HPP and gross profit are answered, but only as far as today.
    const running = c.period.to >= c.today ? `; bulan berjalan, sampai ${c.today} (WIB)` : '';
    switch (id) {
      case 'L-01':
        return t.cogsIdr === null ? c.none('HPP belum lengkap: ada produk terjual tanpa harga beli dari PO yang diterima.') : c.ok(rp(t.cogsIdr), 'HPP: unit terjual dikali harga beli terakhir dari PO yang diterima, tanpa ongkir PO' + running);
      case 'L-06':
        return t.revenueIdr === null || t.cogsIdr === null ? c.none('Laba kotor belum lengkap: omzet atau HPP belum terbaca penuh.') : c.ok(rp(t.revenueIdr - t.cogsIdr), 'laba kotor: omzet dikurangi HPP' + running);
      case 'L-03':
        return t.payrollIdr === null
          ? c.none('Gaji bulan ini belum selesai digaji, atau data gaji tidak terbaca.')
          : c.ok(rp(t.payrollIdr), 'gaji pokok dan tunjangan, belum termasuk bonus, lembur, THR dan BPJS perusahaan');
      case 'L-07':
        return t.netProfitIdr === null
          ? c.none('Laba bersih kosong: satu unsur (omzet, HPP, gaji, komisi, klaim atau refund) belum terbaca, termasuk bulan yang belum digaji.')
          : c.ok(rp(t.netProfitIdr), 'laba bersih rumus 17 Nov 2026: omzet - HPP - gaji pokok dan tunjangan (belum termasuk bonus, lembur, THR dan BPJS perusahaan) - komisi kurir - klaim biaya - refund kasir; kas keluar di luar rumus; sewa dan listrik tidak termasuk');
      default: {
        if (t.netProfitIdr === null) return c.none('Margin kosong: laba bersih belum terbaca.');
        if (t.revenueIdr === null || t.revenueIdr === 0) return c.none('Margin kosong: tidak ada omzet pada bulan ini.');
        return c.ok(pct(t.netProfitIdr, t.revenueIdr), 'margin bersih: laba bersih dibagi omzet; unsur gaji di laba bersih adalah gaji pokok dan tunjangan, belum termasuk bonus, lembur, THR dan BPJS perusahaan');
      }
    }
  }
}
