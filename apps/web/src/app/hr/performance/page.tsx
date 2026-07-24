'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Card, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { currentPeriod, fmtDate, type PerformanceReview } from '@/lib/hr';
import { canManageHr } from '@/lib/roles';

function PerformanceInner() {
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

  async function load() {
    if (!employeeId) { toast('Isi employeeId', 'error'); return; }
    try {
      setRows(await api.get<PerformanceReview[]>(endpoints.hr.performance(employeeId), true));
      setLoaded(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal memuat', 'error');
    }
  }

  async function save() {
    const s = Number(score);
    if (!(s >= 0 && s <= 100)) { toast('Skor 0–100', 'error'); return; }
    setBusy(true);
    try {
      await api.post(endpoints.hr.createPerformance, { employeeId, periodMonth: period, score: s, note: note || undefined }, true);
      toast('Penilaian disimpan');
      setScore(''); setNote('');
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal menyimpan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title="Kinerja" subtitle="Penilaian bulanan (skor 0–100)" />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">Employee ID<Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="UUID karyawan" className="w-64" /></label>
        <Button variant="secondary" onClick={load}>Muat</Button>
      </Card>

      {loaded && (
        <>
          <Card className="divide-y divide-[color:var(--border)]">
            {rows.length === 0 ? <p className="p-4 text-sm text-muted">Belum ada penilaian.</p> : rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3 text-sm">
                <span className="font-medium tabular-nums">{r.periodMonth}</span>
                <span className="text-lg font-extrabold tabular-nums">{r.score}</span>
                <span className="text-muted">{r.note ?? '—'}</span>
                <span className="text-xs text-muted">{fmtDate(r.createdAt)}</span>
              </div>
            ))}
          </Card>

          {isAdmin && (
            <Card className="flex flex-wrap items-end gap-3 p-4">
              <label className="text-sm">Periode<Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
              <label className="text-sm">Skor<Input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} className="w-24" /></label>
              <label className="text-sm">Catatan<Input value={note} onChange={(e) => setNote(e.target.value)} className="w-48" /></label>
              <Button onClick={save} loading={busy}>Simpan</Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default function PerformancePage() {
  return <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-3xl" />}><PerformanceInner /></Suspense>;
}
