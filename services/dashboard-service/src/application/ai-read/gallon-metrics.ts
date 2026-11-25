import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser, addLocalDays, dayStartUtc } from '@hydromart/platform';

import { AiCustomerSourcesPort, GallonLedgerRow } from '../ports/ai-customer-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { CumulativeScopeService, heldBackNote } from './cumulative-scope.service';
import { AnswerEnvelope } from './envelope';
import { DOWN, GroupCtx, GroupMetricMeta, NO_SCOPE, TOO_MANY, fitsOneRead, openGroup, sourceSpans } from './group-context';
import { PeriodQuery } from './period';
import { ReadScopeService } from './scope.service';
import { DEPOTS_PER_READ, depotsOn, stretchesOf } from './stretches';

/** Gallons count things, not people: no masking. The metrics are the dictionary's section 3.2. */
export const GALLON_METRICS = {
  'G-01': { unit: 'galon' },
  'G-02': { unit: 'galon' },
  'G-03': { unit: 'Rp' },
  'G-04': { unit: 'galon' },
  'G-05': { unit: 'transaksi' },
} as const satisfies Record<string, GroupMetricMeta>;
export type GallonMetricId = keyof typeof GALLON_METRICS;
export const GALLON_METRIC_IDS = Object.keys(GALLON_METRICS) as GallonMetricId[];

const rp = (n: number): number => Math.round(n);
const sum = (rows: readonly GallonLedgerRow[], pick: (r: GallonLedgerRow) => number): number => rows.reduce((n, r) => n + pick(r), 0);

@Injectable()
export class GallonMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    private readonly cumulative: CumulativeScopeService,
    @Inject(DASHBOARD_TOKENS.AiCustomerSources) private readonly sources: AiCustomerSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    const c = await openGroup(this.scopes, GALLON_METRICS, 'galon', metricId, user, query, now);
    if (c.scope.spans.length === 0) return c.none(NO_SCOPE);
    switch (metricId as GallonMetricId) {
      case 'G-01':
      case 'G-05':
        return this.sold(metricId as 'G-01' | 'G-05', c);
      case 'G-02':
      case 'G-03':
        return this.balance(metricId as 'G-02' | 'G-03', c);
      default:
        return this.returned(c);
    }
  }

  private async sold(id: 'G-01' | 'G-05', c: GroupCtx): Promise<AnswerEnvelope> {
    const spans = sourceSpans(c.scope, c.period.timeZone);
    if (!fitsOneRead(spans)) return c.none(TOO_MANY);
    if (id === 'G-01') {
      const n = await this.sources.gallonsSold(spans);
      return n === null
        ? c.none(DOWN)
        : c.ok(n, 'galon terjual: unit galon pada pesanan TERKIRIM atau SELESAI menurut tanggal pesanan dibuat (WIB), termasuk kasir dan galon gratis promo');
    }
    const r = await this.sources.refillSplit(spans);
    return r === null
      ? c.none(DOWN)
      : c.ok(r, 'transaksi kasir yang menjual galon (bukan BATAL/VOID) menurut galon kosong yang dibawa: refill = sebanyak galon yang dibeli atau lebih, partial = sebagian, beli = tidak membawa, notAsked = tidak ditanya. Menghitung transaksi, bukan galon');
  }

  /** Every ledger read of a window, once per stretch and per 100 depots; null if any read fails. */
  private async ledger(depotIds: readonly string[], range: { from: string; to: string }): Promise<GallonLedgerRow[] | null> {
    const out: GallonLedgerRow[] = [];
    for (let i = 0; i < depotIds.length; i += DEPOTS_PER_READ) {
      const rows = await this.sources.gallonLedger(depotIds.slice(i, i + DEPOTS_PER_READ), range);
      if (!rows) return null;
      out.push(...rows);
    }
    return out;
  }

  /** The window's sums of the ledger, for the days each depot was readable. */
  private async inPeriod(c: GroupCtx): Promise<GallonLedgerRow[] | null> {
    const out: GallonLedgerRow[] = [];
    for (const st of stretchesOf(c.scope, c.period)) {
      const rows = await this.ledger(st.depotIds, st.range);
      if (!rows) return null;
      out.push(...rows);
    }
    return out;
  }

  /** G-02 and G-03: the balance at the end of the period (today while it runs), and what moved in the period. */
  private async balance(id: 'G-02' | 'G-03', c: GroupCtx): Promise<AnswerEnvelope> {
    const asOf = c.period.to < c.today ? c.period.to : c.today;
    // A balance adds up ALL history: only depots whose whole history up to asOf the caller may read.
    const split = await this.cumulative.split(c.user, depotsOn(c.scope, asOf), asOf);
    const depotIds = split.readable;
    if (depotIds.length === 0) {
      return split.heldBack.length > 0
        ? c.held(`Depot yang boleh Anda baca baru boleh dibaca belum lama ini; saldo mencakup riwayat sebelum itu yang bukan hak baca Anda${heldBackNote(split.heldBack)}.`)
        : c.none('Tidak ada depot yang boleh Anda baca pada hari terakhir periode ini.');
    }
    const tz = c.period.timeZone;
    const end = addLocalDays(dayStartUtc(asOf, tz), 1, tz).toISOString();
    const [at, moved] = await Promise.all([this.ledger(depotIds, { from: end, to: end }), this.inPeriod(c)]);
    if (!at || !moved) return c.none(DOWN);
    const note = `; saldo pada ${asOf} (akhir hari, WIB) di depot yang seluruh riwayatnya boleh Anda baca pada hari itu, sepanjang waktu; mutasi = yang dibukukan pada periode, hanya hari depot boleh Anda baca${heldBackNote(split.heldBack)}`;
    if (id === 'G-02') {
      return c.ok(
        {
          asOf,
          heldBackDepots: split.heldBack.length,
          gallonsAtCustomers: sum(at, (r) => r.issuedTotal - r.returnedTotal),
          issuedInPeriod: sum(moved, (r) => r.issuedInWindow),
          returnedInPeriod: sum(moved, (r) => r.returnedGoodInWindow + r.returnedDamagedInWindow),
        },
        'galon di pelanggan = galon keluar dikurangi galon kembali' + note,
      );
    }
    return c.ok(
      {
        asOf,
        heldBackDepots: split.heldBack.length,
        depositHeldIdr: rp(sum(at, (r) => r.depositHeldTotal - r.depositRefundedTotal)),
        bookedInPeriodIdr: rp(sum(moved, (r) => r.depositHeldInWindow)),
        refundedInPeriodIdr: rp(sum(moved, (r) => r.depositRefundedInWindow)),
      },
      'deposit galon ditahan = deposit dibukukan dikurangi deposit dikembalikan; titipan pelanggan (kewajiban), bukan omzet; nilainya tarif dikali galon, bukan uang yang diterima' + note,
    );
  }

  private async returned(c: GroupCtx): Promise<AnswerEnvelope> {
    const moved = await this.inPeriod(c);
    if (!moved) return c.none(DOWN);
    return c.ok(
      { good: sum(moved, (r) => r.returnedGoodInWindow), damaged: sum(moved, (r) => r.returnedDamagedInWindow) },
      'galon kembali per kondisi menurut tanggal diterima, dalam galon (bukan jumlah catatan); koreksi pembatalan kasir mengurangi',
    );
  }
}

