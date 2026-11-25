import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuthenticatedUser, addLocalDays, dayStartUtc, depotScopeIds } from '@hydromart/platform';

import { AiLoyaltySourcesPort, LoyaltySpan, MAX_DEPOTS, MAX_SPANS, OpenQueueRow } from '../ports/ai-loyalty-sources.port';
import { AiReadSourcesPort } from '../ports/ai-read-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerEnvelope } from './envelope';
import { SMALL_GROUP_FLAG, SMALL_GROUP_MIN, suppressSmallGroups } from './masking';
import { PeriodQuery, ResolvedPeriod, parsePeriod } from './period';
import { OPEN_MONTH_REASON, isOpen } from './group-context';
import { DOWN, ReadEnv, chunks, makeEnv } from './read-env';
import { ReadScope, ReadScopeService } from './scope.service';
import { depotsOn } from './stretches';

/**
 * HD-6 H4 part 2, the loyalty, referral, promo, subscription and campaign group of the dictionary
 * (section 3.8) and the open queues (3.11, A-01).
 *
 * People: O-02, O-04, O-06, O-08 and O-09 count people (redeemers, members, referees, subscribers,
 * campaign recipients). So each is answered for ONE whole, CLOSED calendar month (two answers never
 * overlap, and a running month watched day by day would step by the one person who acted that day), a
 * group of 1 or 2 people is held back ("kurang dari 3"), a total published beside held cells holds the
 * smallest neighbour back too, and a total as of a date (O-04's accounts) is rounded to a multiple of 5.
 * No name, phone or address is ever read: only counts, sums and opaque depot ids.
 *
 * Network: loyalty accounts, referrals, subscriptions and campaigns carry no depot of their own (a
 * customer's depot is the one he last chose, which moves, so a past month cannot be split by depot
 * without misplacing people). They are therefore answered for the whole network only, and only for a role
 * that reads every depot and every legal entity.
 *
 * Money (O-07) may take any period. O-01, O-03 and O-05 stay belum_ada, each with its reason.
 */
export interface LoyaltyMeta {
  unit: string;
  /** Only ONE whole, closed calendar month. */
  month?: true;
  /** The whole network, for a role that reads all of it. */
  network?: true;
  /** About now: answered over today whatever period was sent. */
  now?: true;
  /** Nothing can be said yet, and why. */
  reason?: string;
}

export const LOYALTY_METRICS = {
  'O-01': { unit: 'poin', reason: 'Poin diberikan per periode belum dihitung di mana pun; loyalty-service hanya menyimpan saldo dan riwayat per akun. Diputuskan tetap belum ada.' },
  'O-02': { unit: 'poin, orang', month: true },
  'O-03': { unit: 'poin', reason: 'Poin kedaluwarsa belum bisa dijawab: penghapusan poin kedaluwarsa mati secara bawaan, jadi tidak ada yang tercatat. Diputuskan tetap belum ada.' },
  'O-04': { unit: 'poin, orang', month: true, network: true },
  'O-05': {
    unit: 'orang',
    reason:
      'Anggota per tingkat belum bisa dijawab: tingkat hanya tersimpan sebagai keadaan hari ini (riwayat tingkat per akhir bulan tidak dicatat), dan hitungan orang yang berubah dari hari ke hari tidak dijawab agar selisihnya tidak menunjuk satu orang. Tingkat juga tersimpan di tiga tempat yang tidak sama (keputusan 28-A(c) belum dibangun).',
  },
  'O-06': { unit: 'orang, poin, persen', month: true, network: true },
  'O-07': { unit: 'Rp, pesanan' },
  'O-08': { unit: 'langganan, orang', month: true, network: true },
  'O-09': { unit: 'orang', month: true, network: true },
  'A-01': { unit: 'item', now: true },
} as const satisfies Record<string, LoyaltyMeta>;
export type LoyaltyMetricId = keyof typeof LOYALTY_METRICS;
export const LOYALTY_METRIC_IDS = Object.keys(LOYALTY_METRICS) as LoyaltyMetricId[];

const NO_SCOPE = 'Tidak ada depot yang boleh Anda baca pada periode ini.';
const NO_DEPOT_NOW = 'Tidak ada depot yang boleh Anda baca hari ini.';
const TOO_MANY = 'Terlalu banyak depot untuk dihitung sekaligus dalam satu jawaban; persempit cakupan atau periode.';
export const SMALL_GROUP_REASON = 'kurang dari 3: kelompok sekecil ini tidak dijawab dengan angkanya, supaya tidak menunjuk satu atau dua orang.';
const NETWORK_ONLY =
  'Angka ini ada untuk seluruh jaringan saja (pelanggan, rujukan, langganan dan kampanye tidak melekat pada satu depot, dan depot yang dipilih pelanggan berpindah); hanya peran yang membaca semua depot dan semua badan hukum yang menjawabnya.';

/** Rounded to a multiple of 5: a total as of a date is never exact. */
export const round5 = (n: number): number => Math.round(n / 5) * 5;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const rp = (n: number): number => Math.round(n);

/** One cell of a people count: the number, or null and the flag when it is a group of 1 or 2. */
const cell = (people: number): { value: number | null; flag?: typeof SMALL_GROUP_FLAG } =>
  people > 0 && people < SMALL_GROUP_MIN ? { value: null, flag: SMALL_GROUP_FLAG } : { value: people };

/** Whether the role reads every depot of the network (no depot scope), the first half of "reads all of it". */
function hasNetworkScope(user: AuthenticatedUser): boolean {
  try {
    return depotScopeIds(user) === undefined;
  } catch {
    return false;
  }
}

/** The granted stretches as the instants a source takes, one entry per (depot, stretch). */
function spansOf(scope: ReadScope, timeZone: string): LoyaltySpan[] {
  return scope.spans.map((s) => ({
    depotId: s.depotId,
    from: dayStartUtc(s.from, timeZone).toISOString(),
    to: addLocalDays(dayStartUtc(s.to, timeZone), 1, timeZone).toISOString(),
  }));
}

const fitsOneRead = (spans: readonly LoyaltySpan[]): boolean =>
  spans.length <= MAX_SPANS && new Set(spans.map((s) => s.depotId)).size <= MAX_DEPOTS;

@Injectable()
export class LoyaltyMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiLoyaltySources) private readonly sources: AiLoyaltySourcesPort,
    @Inject(DASHBOARD_TOKENS.AiReadSources) private readonly grants: AiReadSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    if (!Object.prototype.hasOwnProperty.call(LOYALTY_METRICS, metricId)) {
      throw new NotFoundException('Metrik loyalti, promo dan langganan ini tidak ada di kamus.');
    }
    const id = metricId as LoyaltyMetricId;
    const meta: LoyaltyMeta = LOYALTY_METRICS[id];
    const period = this.periodOf(id, meta, query, now);
    const scope = await this.scopes.resolve(user, period);
    const env = makeEnv(id, meta.unit, period, scope, now);
    if (meta.reason) return env.none(meta.reason);
    // A people count over a month that has not ended steps by the one person who acted that day.
    if (meta.month && isOpen(env)) return env.held(OPEN_MONTH_REASON);
    if (meta.network) return this.network(id, user, env);
    if (id === 'A-01') return this.queues(env);
    if (scope.spans.length === 0) return env.none(NO_SCOPE);
    return id === 'O-02' ? this.redemptions(env, user) : this.discounts(env);
  }

  /**
   * The period asked, as this metric allows it. A metric about now is read over today whatever was sent
   * (a nonsense period is still a 400). A people metric takes exactly one whole calendar month: a day, a
   * week, a year or a free range is a 400, so two answers never overlap.
   */
  private periodOf(id: LoyaltyMetricId, meta: LoyaltyMeta, query: PeriodQuery, now: Date): ResolvedPeriod {
    if (meta.now) {
      if (query.period !== undefined || query.from !== undefined || query.to !== undefined || query.date !== undefined) parsePeriod(query, now);
      return parsePeriod({ period: 'day' }, now);
    }
    if (!meta.month) return parsePeriod(query, now);
    const period = parsePeriod(query, now, { whole: 'month' });
    const oneMonth = (period.unit === 'month' || period.unit === 'range') && period.from.slice(0, 7) === period.to.slice(0, 7);
    if (!oneMonth) throw new BadRequestException(`${id} hanya untuk satu bulan penuh`);
    return period;
  }

  /** O-04, O-06, O-08, O-09: the network, one closed month, and a role that reads all of it. */
  private async network(id: LoyaltyMetricId, user: AuthenticatedUser, env: ReadEnv): Promise<AnswerEnvelope> {
    if (!hasNetworkScope(user)) return env.held(NETWORK_ONLY);
    const grants = await this.grants.aiGrants(user.role);
    if (!grants) return env.none(DOWN);
    if (!grants.all) return env.held(NETWORK_ONLY);
    switch (id) {
      case 'O-04':
        return this.pointsOutstanding(env);
      case 'O-06':
        return this.referrals(env);
      case 'O-08':
        return this.subscriptions(env);
      default:
        return this.campaigns(env);
    }
  }

  /** Whether the role reads every depot and every legal entity (the test `network()` applies). null when the grants cannot be read (never guess "scoped"). */
  private async readsWholeNetwork(user: AuthenticatedUser): Promise<boolean | null> {
    if (!hasNetworkScope(user)) return false;
    const grants = await this.grants.aiGrants(user.role);
    return grants ? grants.all : null;
  }

  /** O-02: points of rewards handed over, by pick-up depot and hand-over day over the days each depot was readable. */
  private async redemptions(env: ReadEnv, user: AuthenticatedUser): Promise<AnswerEnvelope> {
    const spans = spansOf(env.scope, env.period.timeZone);
    if (!fitsOneRead(spans)) return env.none(TOO_MANY);
    const t = await this.sources.redemptions(spans);
    if (!t) return env.none(DOWN);
    // A handed-over reward with no depot recorded is in no depot's number: a network total would undercount.
    // Only a caller who reads the whole network is told: a depot-scoped caller's own rows all have a depot, and
    // the source counts such rows network-wide (over the hull of all spans, so it can only over-flag, never undercount).
    if (t.unplaced > 0) {
      const whole = await this.readsWholeNetwork(user);
      if (whole === null) return env.none(DOWN);
      if (whole) return env.none('Ada penukaran yang sudah diserahkan tanpa depot pengambilan tercatat pada periode ini, jadi angkanya tidak lengkap.');
    }
    if (t.redeemers > 0 && t.redeemers < SMALL_GROUP_MIN) return env.held(SMALL_GROUP_REASON);
    return env.ok(
      { points: t.points, redemptions: t.redemptions, redeemers: t.redeemers },
      'poin yang ditukar: penukaran hadiah yang benar-benar diserahkan (sudah diambil), menurut depot pengambilan dan tanggal serah (WIB); yang batal atau lewat waktu tidak dihitung; hanya depot dan hari yang boleh Anda baca; redeemers = pelanggan berbeda, dihitung sekali walau menukar di beberapa depot',
    );
  }

  /** O-04: the network's points, as of the end of the closed month. */
  private async pointsOutstanding(env: ReadEnv): Promise<AnswerEnvelope> {
    const t = await this.sources.pointsOutstanding(env.period.toAt);
    if (!t) return env.none(DOWN);
    if (t.accounts > 0 && t.accounts < SMALL_GROUP_MIN) return env.held(SMALL_GROUP_REASON);
    return env.ok(
      { asOf: env.period.to, points: t.points, accounts: round5(t.accounts) },
      `poin beredar jaringan per akhir hari ${env.period.to}: seluruh buku poin sampai hari itu, tiap pelanggan sekali, dalam poin saja (belum ada nilai rupiah per poin); poin yang seharusnya sudah kedaluwarsa masih ikut karena penghapusan poin kedaluwarsa mati; accounts = akun loyalti yang sudah ada pada hari itu, dibulatkan ke kelipatan 5 (hitungan orang per tanggal bisa dikurangkan antar tanggal)`,
    );
  }

  /** O-06: referrals made and qualified in the month, both sides' points, network-wide. */
  private async referrals(env: ReadEnv): Promise<AnswerEnvelope> {
    const t = await this.sources.referrals({ from: env.period.fromAt, to: env.period.toAt });
    if (!t) return env.none(DOWN);
    // A referee is referred once, so referral rows are distinct referees: invited and qualified are people already.
    const invited = cell(t.invited);
    const qualified = cell(t.qualified);
    if (invited.flag && qualified.flag) return env.held(SMALL_GROUP_REASON);
    const both = !invited.flag && !qualified.flag && t.invited > 0;
    // Each side's points rest on that side's people; the total would give the held side away, so it is held too.
    const referrerHeld = cell(t.qualifiedReferrers).flag !== undefined;
    const refereeHeld = qualified.flag !== undefined;
    const held = referrerHeld || refereeHeld;
    return env.ok(
      {
        invited,
        qualified,
        // The points of 1 or 2 people are theirs: a side is shown only when 3 or more earned them (or none did).
        points: {
          referrer: referrerHeld ? null : t.referrerPoints,
          referee: refereeHeld ? null : t.refereePoints,
          total: held ? null : t.referrerPoints + t.refereePoints,
          ...(held ? { flag: SMALL_GROUP_FLAG } : {}),
        },
        conversionPct: both ? r1((t.qualified / t.invited) * 100) : null,
      },
      'rujukan jaringan pada bulan ini: invited = kode dipakai (tanggal rujukan dibuat); qualified = rujukan yang masih berstatus memenuhi syarat dan memenuhi syarat pada bulan ini (yang pesanannya dibatalkan dibuka lagi dan tidak dihitung); invited dan qualified menghitung orang yang diajak (satu orang hanya diajak sekali); points = poin kedua sisi (pengajak dan yang diajak) dari rujukan itu, sebelum pengurangan poin yang sudah terpakai, sisi pengajak ditahan bila pengajaknya kurang dari 3 orang, sisi yang diajak bila kurang dari 3 orang, dan total ditahan bila salah satunya ditahan; conversionPct = qualified / invited pada bulan yang sama (bukan satu kohort, bisa lewat 100). Kelompok kurang dari 3 orang ditahan',
    );
  }

  /** O-07: the discounts on orders that count, by order date, over the days each depot was readable. */
  private async discounts(env: ReadEnv): Promise<AnswerEnvelope> {
    const spans = spansOf(env.scope, env.period.timeZone);
    if (!fitsOneRead(spans)) return env.none(TOO_MANY);
    const t = await this.sources.discounts(spans);
    if (!t) return env.none(DOWN);
    return env.ok(
      {
        orders: t.orders,
        discountedOrders: t.discountedOrders,
        discountIdr: rp(t.discountIdr),
        byKind: { status: 'belum_ada', reason: 'Pesanan hanya menyimpan satu angka potongan; promo, voucher, member, langganan dan reseller tidak bisa dipisah.' },
      },
      'biaya potongan: seluruh potongan tingkat pesanan (semua jenis jadi satu) pada pesanan yang dihitung omzet (bukan BATAL atau VOID), menurut tanggal pesanan dibuat (WIB); hanya depot dan hari yang boleh Anda baca; potongan pada harga barang, ongkir tidak termasuk',
    );
  }

  /** O-08: subscriptions made in the month, network-wide. Active and stopped counts are not built (no history). */
  private async subscriptions(env: ReadEnv): Promise<AnswerEnvelope> {
    const t = await this.sources.newSubscriptions({ from: env.period.fromAt, to: env.period.toAt });
    if (!t) return env.none(DOWN);
    if (t.subscribers > 0 && t.subscribers < SMALL_GROUP_MIN) return env.held(SMALL_GROUP_REASON);
    return env.ok(
      {
        new: { subscriptions: t.subscriptions, subscribers: t.subscribers },
        active: { status: 'belum_ada', reason: 'Langganan aktif per tanggal tidak bisa dijawab: jeda tidak dicatat sebagai riwayat, dan hitungan orang hari ini tidak dijawab.' },
        stopped: { status: 'belum_ada', reason: 'Langganan yang berhenti per periode belum bisa dijawab: tanggal berhenti tidak dicatat.' },
        estimatedMonthlyDeliveries: { status: 'belum_ada', reason: 'Perkiraan pengantaran per bulan memakai langganan aktif, yang belum bisa dijawab.' },
      },
      'langganan baru: paket langganan yang dibuat pada bulan ini (apa pun statusnya sekarang) di mesin langganan order-service, termasuk yang dibuatkan depot; subscribers = pelanggan berbeda; seluruh jaringan, tidak per depot (depot pengantar paket berpindah mengikuti titik alamat)',
    );
  }

  /** O-09: campaigns that finished sending in the month, network-wide, their recipients by outcome. */
  private async campaigns(env: ReadEnv): Promise<AnswerEnvelope> {
    const t = await this.sources.campaigns({ from: env.period.fromAt, to: env.period.toAt });
    if (!t) return env.none(DOWN);
    const cells = [
      { key: 'terkirim', people: t.sent },
      { key: 'gagal', people: t.failed },
      { key: 'dilewati', people: t.skipped },
      { key: 'lainnya', people: t.other },
    ];
    const total = cells.reduce((n, c) => n + c.people, 0);
    const m = suppressSmallGroups(cells, total);
    // No total could be published without giving a small cell away: every cell that has people is held.
    if (m.total === null) return env.held(SMALL_GROUP_REASON);
    return env.ok(
      {
        campaigns: t.campaigns,
        recipients: m.total,
        cells: m.cells.map((c) => ({ outcome: c.key, value: c.value, ...(c.flag ? { flag: c.flag } : {}) })),
      },
      'kampanye yang selesai dikirim pada bulan ini (menurut saat selesai), seluruh jaringan: penerima menurut hasil, terkirim = masuk kotak pesan aplikasi, dilewati = menolak pemasaran, lainnya = penerima dengan status lain, termasuk yang belum terkirim; hanya kampanye yang sudah selesai dihitung; tidak ada angka "dibaca"; seorang penerima di dua kampanye terhitung dua kali. Kelompok kurang dari 3 orang ditahan beserta tetangga terkecilnya',
    );
  }

  /** A-01: what is open at each readable depot right now. Items, not people. */
  private async queues(env: ReadEnv): Promise<AnswerEnvelope> {
    const depots = depotsOn(env.scope, env.today);
    if (depots.length === 0) return env.none(NO_DEPOT_NOW);
    const rows: OpenQueueRow[] = [];
    for (const part of chunks(depots, MAX_DEPOTS)) {
      const got = await this.sources.openQueues(part);
      if (!got) return env.none(DOWN);
      rows.push(...got);
    }
    const sum = (pick: (r: OpenQueueRow) => number): number => rows.reduce((n, r) => n + pick(r), 0);
    return env.ok(
      {
        depots: depots.length,
        incidents: sum((r) => r.incidents),
        disputes: sum((r) => r.disputes),
        approvals: sum((r) => r.approvals),
        maintenanceOverdue: sum((r) => r.maintenanceOverdue),
        byDepot: rows,
      },
      'item yang masih terbuka sekarang di depot yang boleh Anda baca: insiden belum selesai (baru atau diproses), sengketa pesanan terbuka, persetujuan depot menunggu keputusan (selisih hitung, refund deposit, selisih COD dan galon), perawatan yang tanggal berikutnya sudah lewat; tidak diperiksa mendalam',
    );
  }
}
