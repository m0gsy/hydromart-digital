'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Card, Input, SectionHeader } from '@/components/ui';
import { endpoints } from '@/lib/endpoints';
import { currentPeriod } from '@/lib/hr';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

/** Fetch a CSV export (cookie-authenticated) and trigger a browser download. */
async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Gagal mengunduh (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { toast } = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');

  async function run(key: string, path: string, filename: string) {
    setBusy(key);
    try {
      await download(path, filename);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mengunduh', 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <SectionHeader title="Laporan" subtitle="Ekspor CSV (buka di Excel)" />

      <Card className="flex items-center justify-between gap-3 p-4">
        <div><p className="font-semibold">Direktori Karyawan</p><p className="text-xs text-muted">Semua karyawan (sesuai cakupan depot).</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" loading={busy === 'emp'} onClick={() => run('emp', endpoints.hr.reportEmployees(), 'employees.csv')}>CSV</Button>
          <Button variant="secondary" loading={busy === 'empx'} onClick={() => run('empx', endpoints.hr.reportEmployees(undefined, 'xlsx'), 'employees.xlsx')}>Excel</Button>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <p className="font-semibold">Absensi</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Dari<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-sm">Sampai<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Button
            variant="secondary"
            loading={busy === 'att'}
            onClick={() => {
              if (!from || !to) { toast('Isi rentang tanggal', 'error'); return; }
              run('att', endpoints.hr.reportAttendance(from, to), `attendance-${from}_${to}.csv`);
            }}
          >CSV</Button>
          <Button
            variant="secondary"
            loading={busy === 'attx'}
            onClick={() => {
              if (!from || !to) { toast('Isi rentang tanggal', 'error'); return; }
              run('attx', endpoints.hr.reportAttendance(from, to, undefined, 'xlsx'), `attendance-${from}_${to}.xlsx`);
            }}
          >Excel</Button>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <p className="font-semibold">Payroll</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Periode<Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
          <Button variant="secondary" loading={busy === 'pay'} onClick={() => run('pay', endpoints.hr.reportPayroll(period), `payroll-${period}.csv`)}>CSV</Button>
          <Button variant="secondary" loading={busy === 'payx'} onClick={() => run('payx', endpoints.hr.reportPayroll(period, undefined, 'xlsx'), `payroll-${period}.xlsx`)}>Excel</Button>
        </div>
      </Card>
    </div>
  );
}
