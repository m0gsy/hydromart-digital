'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Button, Card, ErrorState, Input, SectionHeader, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { fmtDate, type Holiday, type Shift } from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

export default function CalendarPage() {
  const { customer } = useAuth();
  const { toast } = useToast();
  const isAdmin = canManageHr(customer?.role);

  const holidays = useAsync<Holiday[]>(() => api.get<Holiday[]>(endpoints.hr.holidays(), true), []);
  const shifts = useAsync<Shift[]>(() => api.get<Shift[]>(endpoints.hr.shifts(), true), []);

  const [hDate, setHDate] = useState('');
  const [hName, setHName] = useState('');
  const [sName, setSName] = useState('');
  const [sStart, setSStart] = useState('08:00');
  const [sEnd, setSEnd] = useState('17:00');

  async function addHoliday() {
    if (!hDate || !hName) { toast('Isi tanggal & nama', 'error'); return; }
    try {
      await api.post(endpoints.hr.createHoliday, { date: new Date(hDate).toISOString(), name: hName }, true);
      toast('Hari libur ditambahkan'); setHDate(''); setHName(''); holidays.reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Gagal', 'error'); }
  }
  async function delHoliday(id: string) {
    try { await api.del(endpoints.hr.deleteHoliday(id), true); toast('Dihapus'); holidays.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Gagal', 'error'); }
  }
  async function addShift() {
    if (!sName) { toast('Isi nama shift', 'error'); return; }
    try {
      await api.post(endpoints.hr.createShift, { name: sName, startTime: sStart, endTime: sEnd }, true);
      toast('Shift ditambahkan'); setSName(''); shifts.reload();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Gagal', 'error'); }
  }
  async function delShift(id: string) {
    try { await api.del(endpoints.hr.deleteShift(id), true); toast('Dihapus'); shifts.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Gagal', 'error'); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SectionHeader title="Kalender Kerja" subtitle="Hari libur & shift — dipakai kalkulasi keterlambatan + potongan absen" />

      <Card className="space-y-3 p-5">
        <h3 className="font-bold">Hari Libur</h3>
        {holidays.loading && <Skeleton className="h-20" />}
        {holidays.error && <ErrorState message={holidays.error} onRetry={holidays.reload} />}
        {holidays.data && (
          <ul className="divide-y divide-[color:var(--border)]">
            {holidays.data.length === 0 && <li className="py-2 text-sm text-muted">Belum ada hari libur.</li>}
            {holidays.data.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span><b>{fmtDate(h.date)}</b> · {h.name}{h.depotId ? ' (depot)' : ' (nasional)'}</span>
                {isAdmin && <Button variant="ghost" onClick={() => delHoliday(h.id)}>Hapus</Button>}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-app pt-3">
            <label className="text-sm">Tanggal<Input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} /></label>
            <label className="text-sm">Nama<Input value={hName} onChange={(e) => setHName(e.target.value)} placeholder="Hari Kemerdekaan" /></label>
            <Button onClick={addHoliday}>Tambah</Button>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="font-bold">Shift</h3>
        {shifts.loading && <Skeleton className="h-20" />}
        {shifts.data && (
          <ul className="divide-y divide-[color:var(--border)]">
            {shifts.data.length === 0 && <li className="py-2 text-sm text-muted">Belum ada shift (pakai default {`{workStartTime}`}).</li>}
            {shifts.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span><b>{s.name}</b> · {s.startTime}–{s.endTime}{s.active ? '' : ' (nonaktif)'}{s.depotId ? ' · depot' : ''}</span>
                {isAdmin && <Button variant="ghost" onClick={() => delShift(s.id)}>Hapus</Button>}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-app pt-3">
            <label className="text-sm">Nama<Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Pagi" className="w-32" /></label>
            <label className="text-sm">Mulai<Input type="time" value={sStart} onChange={(e) => setSStart(e.target.value)} /></label>
            <label className="text-sm">Selesai<Input type="time" value={sEnd} onChange={(e) => setSEnd(e.target.value)} /></label>
            <Button onClick={addShift}>Tambah</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
