import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { can } from '@hydromart/access';
import { AuthenticatedUser } from '@hydromart/platform';

import { ATTENDANCE_CELLS, AiOrgSourcesPort, AttendanceCell, PayrollRow } from '../ports/ai-org-sources.port';
import { DashboardSourcesPort } from '../ports/dashboard-sources.port';
import { DASHBOARD_TOKENS } from '../tokens';
import { AnswerEnvelope } from './envelope';
import { SMALL_GROUP_FLAG, SMALL_GROUP_MIN, suppressSmallGroups } from './masking';
import { PeriodQuery, parsePeriod } from './period';
import { DOWN, ReadEnv, chunks, makeEnv, narrowTo, payrollUnfinished, pooled, stretchesOf } from './read-env';
import { ReadScope, ReadScopeService } from './scope.service';

/**
 * HD-6 H5, the HR metrics of the metric dictionary (section 3.10). `month` = only defined over one
 * whole calendar month. Every figure here rests on employees, so a depot whose figure rests on 1 or
 * 2 people is never published (masking.ts), and pay figures need payrollRead and a finished month
 * (choice 10A: only APPROVED/PAID slips, and a month not fully paid is belum_ada, never 0).
 */
export const HR_METRICS = {
  'H-01': { unit: 'orang' },
  'H-02': { unit: 'hari' },
  'H-03': { unit: 'Rp', month: true },
  'H-04': { unit: 'Rp', month: true },
  'H-05': { unit: 'Rp', month: true },
  'H-06': { unit: 'jam' },
  'H-07': { unit: 'persen' },
} as const satisfies Record<string, { unit: string; month?: boolean }>;
export type HrMetricId = keyof typeof HR_METRICS;
export const HR_METRIC_IDS = Object.keys(HR_METRICS) as HrMetricId[];

/** The depots readable on `day`, sorted. */
const readableOn = (scope: ReadScope, day: string): string[] =>
  [...new Set(scope.spans.filter((s) => s.from <= day && day <= s.to).map((s) => s.depotId))].sort();

const small = (people: number): boolean => people > 0 && people < SMALL_GROUP_MIN;

@Injectable()
export class HrMetricsService {
  constructor(
    private readonly scopes: ReadScopeService,
    @Inject(DASHBOARD_TOKENS.AiOrgSources) private readonly sources: AiOrgSourcesPort,
    @Inject(DASHBOARD_TOKENS.Sources) private readonly depots: DashboardSourcesPort,
  ) {}

  async answer(metricId: string, user: AuthenticatedUser, query: PeriodQuery, now: Date = new Date()): Promise<AnswerEnvelope> {
    if (!Object.prototype.hasOwnProperty.call(HR_METRICS, metricId)) {
      throw new NotFoundException('Metrik SDM ini tidak ada di kamus.');
    }
    const id = metricId as HrMetricId;
    const meta: { unit: string; month?: boolean } = HR_METRICS[id];
    const period = parsePeriod(query, now, meta.month ? { whole: 'month' } : {});
    if (meta.month && period.from.slice(0, 7) !== period.to.slice(0, 7)) {
      throw new BadRequestException(`${id} hanya untuk satu bulan penuh`);
    }
    const scope = await this.scopes.resolve(user, period);
    const env = makeEnv(id, meta.unit, period, scope, now);
    if (id === 'H-06') return env.none('Lembur dalam jam dan rupiah belum tercatat terpisah; hari ini hanya ada sebagai teks di baris slip.');
    if (id === 'H-07') return env.none('Turnover belum dihitung di mana pun; riwayat karyawan keluar per periode belum disimpan.');
    if (scope.spans.length === 0) return env.none('Tidak ada depot yang boleh Anda baca pada periode ini.');
    if (id === 'H-01') return this.headcount(env, now);
    if (id === 'H-02') return this.attendance(env);
    return this.pay(id, user, env, now);
  }

  /** H-01: AKTIF employees by assignment depot, today only (status history is not kept). */
  private async headcount(env0: ReadEnv, now: Date): Promise<AnswerEnvelope> {
    const { period, today } = env0;
    if (today < period.from || today > period.to) {
      return env0.none('Karyawan aktif hanya bisa dijawab untuk hari ini; riwayat status karyawan belum disimpan.');
    }
    const ids = readableOn(env0.scope, today);
    if (ids.length === 0) return env0.none('Tidak ada depot yang boleh Anda baca hari ini.');
    const env = makeEnv('H-01', HR_METRICS['H-01'].unit, period, narrowTo(env0.scope, new Set(ids)), now);
    const summaries: Awaited<ReturnType<DashboardSourcesPort['hrSummaryMany']>> = [];
    for (const part of chunks(ids)) summaries.push(...(await this.depots.hrSummaryMany([...part])));
    if (summaries.some((r) => r === null || typeof r.activeHeadcount !== 'number')) return env.none(DOWN);
    const cells = ids.map((key, i) => ({ key, people: summaries[i]!.activeHeadcount }));
    const total = cells.reduce((s, c) => s + c.people, 0);
    const masked = suppressSmallGroups(cells, total);
    return env.ok(
      {
        total: masked.total,
        ...(masked.totalFlag ? { totalFlag: masked.totalFlag } : {}),
        byDepot: masked.cells.map((c) => ({ depotId: c.key, value: c.value, ...(c.flag ? { flag: c.flag } : {}) })),
      },
      `karyawan berstatus AKTIF menurut depot penugasan hari ini (${today}); staf tanpa depot tidak terhitung; satu depot dengan kurang dari 3 orang tidak diberikan angkanya`,
    );
  }

  /**
   * H-02: attendance counts. Only what is recorded: the scheduled-days denominator (the rate) is not
   * built, so `absentRecorded` is explicit ABSENT rows, NOT choice 35A's "scheduled day with no punch
   * and no leave". Each count is held back on its OWN people: a count resting on 1 or 2 employees is
   * null with a flag. People are counted per depot per cell, the most any one stretch of the depot
   * shows (the same person can span two stretches), then summed over depots.
   */
  private async attendance(env: ReadEnv): Promise<AnswerEnvelope> {
    const sums = Object.fromEntries(ATTENDANCE_CELLS.map((c) => [c, 0])) as Record<AttendanceCell, number>;
    const heads = new Map<string, Record<AttendanceCell, number>>();
    for (const st of stretchesOf(env.scope, env.period)) {
      for (const ids of chunks(st.depotIds)) {
        const got = await this.sources.attendance(ids, st.from, st.to);
        if (!got) return env.none(DOWN);
        if (got.rolledUp) {
          return env.none('Sebagian catatan lama sudah dirangkum per bulan (setelah masa simpan karyawan keluar), jadi hitungan harian periode ini tidak lengkap.');
        }
        for (const row of got.rows) {
          const seen = heads.get(row.depotId) ?? ({ ...row.people } as Record<AttendanceCell, number>);
          for (const c of ATTENDANCE_CELLS) {
            sums[c] += row[c];
            seen[c] = Math.max(seen[c], row.people[c]);
          }
          heads.set(row.depotId, seen);
        }
      }
    }
    const people = Object.fromEntries(
      ATTENDANCE_CELLS.map((c) => [c, [...heads.values()].reduce((n, h) => n + h[c], 0)]),
    ) as Record<AttendanceCell, number>;
    const flags: Partial<Record<AttendanceCell, string>> = {};
    const value: Record<string, unknown> = {};
    for (const c of ATTENDANCE_CELLS) {
      if (small(people[c])) {
        flags[c] = SMALL_GROUP_FLAG;
        value[c] = null;
      } else {
        value[c] = sums[c];
      }
    }
    const flagged = Object.keys(flags).length;
    if (flagged > 0 && ATTENDANCE_CELLS.every((c) => people[c] === 0 || flags[c])) {
      return env.held(`Karyawan di balik angka kehadiran ${SMALL_GROUP_FLAG}; angkanya tidak diberikan.`);
    }
    return env.ok(
      {
        ...value,
        ...(flagged > 0 ? { flags } : {}),
        rate: { status: 'belum_ada', reason: 'Tingkat hadir butuh hari kerja terjadwal per karyawan; itu belum dihitung di sini.' },
      },
      'hari kerja menurut tanggal kerja WIB dan depot tempat bekerja hari itu: present = hadir, late = terlambat, absentRecorded = hanya catatan ABSEN eksplisit (BUKAN hari terjadwal tanpa absen dan tanpa cuti: hari tanpa catatan tidak terlihat), leave = cuti, pending = absen offline belum diputuskan HR; tiap angka yang bertumpu pada kurang dari 3 karyawan tidak diberikan (null dengan flag)',
    );
  }

  /** H-03, H-04, H-05: pay figures of one finished month, for the depots readable on its last day. */
  private async pay(id: 'H-03' | 'H-04' | 'H-05', user: AuthenticatedUser, env0: ReadEnv, now: Date): Promise<AnswerEnvelope> {
    const { period } = env0;
    const month = period.from.slice(0, 7);
    // Choice 33A: payroll belongs to the entity the depot had on the last day of the payroll month.
    const ids = readableOn(env0.scope, period.to);
    const env = makeEnv(id, HR_METRICS[id].unit, period, narrowTo(env0.scope, new Set(ids)), now);
    if (ids.length === 0) return env.none('Tidak ada depot yang boleh Anda baca pada hari terakhir bulan ini.');
    if (!can('payrollRead', user.role, ids)) return env.held('Gaji dan kasbon hanya untuk peran yang boleh membaca penggajian.');
    const unfinished = await payrollUnfinished(this.depots, ids, month);
    if (unfinished) return env.none(unfinished);
    if (id === 'H-04') return this.kasbon(env, ids, month);
    const rows = await pooled(ids, (part) => this.sources.payroll(part, month));
    if (!rows) return env.none(DOWN);
    const sum = (pick: (r: PayrollRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
    const people = id === 'H-03' ? sum((r) => r.slips) : sum((r) => r.gallonPeople);
    if (small(people)) return env.held(`Karyawan yang menerima angka ini ${SMALL_GROUP_FLAG}; jumlahnya tidak diberikan.`);
    if (id === 'H-05') {
      return env.ok(
        sum((r) => r.gallonBonusIdr),
        'bonus target galon harian pada slip DISETUJUI/DIBAYAR bulan ini (baris "Bonus target harian"), menurut depot asal karyawan (homeDepotId, bila kosong depot tempatnya) saat ini, untuk depot yang boleh Anda baca pada hari terakhir bulan; karyawan tanpa depot tidak terhitung',
      );
    }
    if (people === 0) return env.none('Tidak ada slip gaji disetujui atau dibayar pada bulan ini.');
    return env.ok(
      {
        slips: people,
        grossIdr: Math.round(sum((r) => r.grossIdr)),
        bonusIdr: Math.round(sum((r) => r.bonusIdr)),
        deductionIdr: Math.round(sum((r) => r.deductionIdr)),
        netIdr: Math.round(sum((r) => r.netIdr)),
      },
      'slip DISETUJUI/DIBAYAR bulan ini, menurut depot asal karyawan (homeDepotId, bila kosong depot tempatnya) saat ini; karyawan tanpa depot tidak terhitung; bruto = gaji pokok + tunjangan, bonus terpisah, bersih = bruto + bonus - potongan',
    );
  }

  /** H-04: what is still owed on active kasbon at the end of the month. */
  private async kasbon(env: ReadEnv, ids: readonly string[], month: string): Promise<AnswerEnvelope> {
    const rows = await pooled(ids, (part) => this.sources.kasbon(part, month));
    if (!rows) return env.none(DOWN);
    const shown = rows.filter((r) => !small(r.people));
    const heldBackDepots = rows.length - shown.length;
    if (heldBackDepots > 0 && shown.every((r) => r.people === 0)) {
      return env.held(`Karyawan yang masih berutang kasbon ${SMALL_GROUP_FLAG} per depot; jumlahnya tidak diberikan.`);
    }
    return env.ok(
      {
        remainingIdr: Math.round(shown.reduce((s, r) => s + r.remainingIdr, 0)),
        people: shown.reduce((s, r) => s + r.people, 0),
        heldBackDepots,
      },
      'sisa kasbon aktif sampai akhir bulan: pokok dikurangi potongan pada slip DISETUJUI/DIBAYAR; depot asal karyawan saat ini; karyawan tanpa depot tidak terhitung; depot dengan kurang dari 3 peminjam tidak ikut dijumlah (heldBackDepots); kasbon yang dinonaktifkan dianggap lunas',
    );
  }
}
