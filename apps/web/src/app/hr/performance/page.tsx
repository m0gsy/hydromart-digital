'use client';

import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/locale-context';
import { Suspense, useState } from 'react';

import { EmployeeSelect } from '@/components/hr/employee-select';
import { useToast } from '@/components/toast';
import { Button, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  currentPeriod,
  fmtDate,
  fmtScore,
  type PerformanceReview,
  type ScoredEmployee,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

function PerformanceInner() {
  const { t } = useT();
  const { customer } = useAuth();
  const { toast } = useToast();
  const isAdmin = canManageHr(customer?.role);
  const [employeeId, setEmployeeId] = useState(useSearchParams().get('employeeId') ?? '');
  const [rows, setRows] = useState<PerformanceReview[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [period, setPeriod] = useState(currentPeriod());
  const [score, setScore] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [computed, setComputed] = useState<ScoredEmployee | null>(null);

  async function load() {
    if (!employeeId) {
      toast(t('hrFix.performance.fillEmployeeId'), 'error');
      return;
    }
    try {
      setRows(await api.get<PerformanceReview[]>(endpoints.hr.performance(employeeId), true));
      setLoaded(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.performance.loadFailed'), 'error');
    }
  }

  /**
   * Pull the COMPUTED score for this employee and period, and put it in the field.
   *
   * `GET /performance/score` has always existed and nothing called it, so the review form
   * asked for a 0–100 with nothing to base it on — a monthly verdict typed from memory.
   * It saves nothing on its own: the reviewer still decides what to record, they just
   * start from the measurement rather than from a blank box.
   */
  async function computeScore() {
    if (!employeeId) {
      toast(t('hrFix.performance.fillEmployeeId'), 'error');
      return;
    }
    setScoring(true);
    try {
      const scored = await api.get<ScoredEmployee>(
        endpoints.hr.performanceScore(employeeId, period),
        true,
      );
      if (scored.score.final == null) {
        toast(t('hrFix.performance.nothingMeasurable'), 'error');
        return;
      }
      setScore(String(Math.round(scored.score.final)));
      setComputed(scored);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.performance.scoreFailed'), 'error');
    } finally {
      setScoring(false);
    }
  }

  async function save() {
    const s = Number(score);
    if (!(s >= 0 && s <= 100)) {
      toast(t('hrFix.performance.scoreRange'), 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(
        endpoints.hr.createPerformance,
        { employeeId, periodMonth: period, score: s, note: note || undefined },
        true,
      );
      toast(t('hrFix.performance.saved'));
      setScore('');
      setNote('');
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader
        title={t('hrFix.performance.title')}
        subtitle={t('hrFix.performance.subtitle')}
      />

      <ScoreDashboard period={period} onPeriod={setPeriod} isAdmin={isAdmin} />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        {/* G-1: this page already lists scored employees by name — the box that chose one
            was still a UUID field. */}
        <EmployeeSelect value={employeeId} onChange={setEmployeeId} className="w-64" />
        <Button variant="secondary" onClick={load}>
          Muat riwayat
        </Button>
      </Card>

      {loaded && (
        <>
          <Card className="divide-y divide-[color:var(--border)]">
            {rows.length === 0 ? (
              <p className="p-4 text-sm text-muted">{t('hrFix.performance.empty')}</p>
            ) : (
              rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-3 text-sm">
                  <span className="font-medium tabular-nums">{r.periodMonth}</span>
                  <span className="text-lg font-extrabold tabular-nums">{r.score}</span>
                  <span className="text-muted">{r.note ?? r.managerNote ?? '—'}</span>
                  <span className="text-xs text-muted">{fmtDate(r.createdAt)}</span>
                </div>
              ))
            )}
          </Card>

          {isAdmin && (
            <Card className="flex flex-wrap items-end gap-3 p-4">
              <label className="text-sm">
                Periode
                <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
              </label>
              <label className="text-sm">
                Skor
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  className="w-24"
                />
              </label>
              <label className="text-sm">
                Catatan
                <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-48" />
              </label>
              <Button variant="secondary" onClick={computeScore} loading={scoring}>
                Hitung skor
              </Button>
              <Button onClick={save} loading={busy}>
                Simpan manual
              </Button>
              {computed?.score.final != null && (
                <p className="w-full text-xs text-muted">
                  Terukur: absensi {computed.score.attendance ?? '—'} · disiplin{' '}
                  {computed.score.discipline ?? '—'} · penjualan {computed.score.sales ?? '—'} · akhir{' '}
                  {computed.score.final}. Komponen yang tidak terukur tidak ikut dihitung.
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Everyone in scope, scored for the period. A "—" in a column means that component had
 * nothing to measure against, not a zero — see domain/performance-score.ts.
 */
function ScoreDashboard({
  period,
  onPeriod,
  isAdmin,
}: {
  period: string;
  onPeriod: (p: string) => void;
  isAdmin: boolean;
}) {
  const { t } = useT();
  const { depots } = useDepot();
  const { toast } = useToast();
  const [depotId, setDepotId] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const board = useAsync<ScoredEmployee[]>(
    () =>
      api.get<ScoredEmployee[]>(
        endpoints.hr.performanceDashboard(period, depotId || undefined),
        true,
      ),
    [period, depotId],
  );

  async function persist(row: ScoredEmployee) {
    setSaving(row.employeeId);
    try {
      await api.post(
        endpoints.hr.generatePerformance,
        { employeeId: row.employeeId, periodMonth: period },
        true,
      );
      toast(`Penilaian ${row.fullName} tersimpan`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal menyimpan', 'error');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Periode
          <Input type="month" value={period} onChange={(e) => onPeriod(e.target.value)} />
        </label>
        <label className="text-sm">
          Depot
          <select
            value={depotId}
            onChange={(e) => setDepotId(e.target.value)}
            className="surface-elevated block rounded-lg border border-app px-3 py-2.5 text-sm"
          >
            <option value="">{t('hrFix.performance.allDepots')}</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      {board.loading && <Skeleton className="h-40" />}
      {board.error && <ErrorState message={board.error} onRetry={board.reload} />}
      {board.data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2">{t('hrFix.performance.employee')}</th>
                <th className="py-2 text-right">{t('hrFix.performance.attendance')}</th>
                <th className="py-2 text-right">{t('hrFix.performance.discipline')}</th>
                <th className="py-2 text-right">{t('hrFix.performance.sales')}</th>
                <th className="py-2 text-right">{t('hrFix.performance.score')}</th>
                {isAdmin && <th className="py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {board.data.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="py-3 text-muted">
                    Tidak ada karyawan aktif pada lingkup ini.
                  </td>
                </tr>
              )}
              {board.data.map((r) => (
                <tr key={r.employeeId}>
                  <td className="py-2">
                    <span className="font-medium">{r.fullName}</span>
                    <span className="block text-xs text-muted">
                      {r.employeeCode} · {r.position} · {r.inputs.presentDays}/
                      {r.inputs.workingDays} hari, {r.inputs.lateDays}× terlambat
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtScore(r.score.attendance)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtScore(r.score.discipline)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtScore(r.score.sales)}</td>
                  <td className="py-2 text-right text-base font-extrabold tabular-nums">
                    {fmtScore(r.score.final)}
                  </td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        loading={saving === r.employeeId}
                        onClick={() => persist(r)}
                      >
                        Simpan
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        “—” berarti komponen itu tidak bisa diukur pada periode ini (tidak ada hari kerja terjadwal,
        tidak ada kehadiran, atau target penjualan belum diatur) — bukan nilai nol. Bobot komponen
        diatur di Konfigurasi Gaji.
      </p>
    </Card>
  );
}

export default function PerformancePage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-3xl" />}>
      <PerformanceInner />
    </Suspense>
  );
}
