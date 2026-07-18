'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarBlank, CaretLeft, CaretRight, DownloadSimple, Lock, PencilSimple, UsersThree } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { isStaff } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Customer, ShiftAssignment, ShiftKind } from '@/lib/types';

const DAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Pagi → Sore → Libur → Pagi. An empty cell is treated as Libur.
const CYCLE: Record<ShiftKind, ShiftKind> = { OFF: 'MORNING', MORNING: 'EVENING', EVENING: 'OFF' };
const SHIFT_LABEL: Record<ShiftKind, string> = { MORNING: 'Pagi', EVENING: 'Sore', OFF: 'Libur' };
const SHIFT_STYLE: Record<ShiftKind, string> = {
  MORNING: 'bg-brand-50 text-brand-800',
  EVENING: 'bg-amber-100 text-amber-800',
  OFF: 'bg-[color:var(--surface-muted)] text-[color:var(--text-muted)]',
};

function mondayOf(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // getDay 0=Sun → shift to Mon
  return isoDate(x);
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftWeek(weekStart: string, deltaWeeks: number): string {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + deltaWeeks * 7);
  return isoDate(d);
}
function weekLabel(weekStart: string): string {
  const s = new Date(`${weekStart}T00:00:00`);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  const range =
    s.getMonth() === e.getMonth()
      ? `${s.getDate()}–${e.getDate()} ${MONTHS[e.getMonth()]}`
      : `${s.getDate()} ${MONTHS[s.getMonth()]} – ${e.getDate()} ${MONTHS[e.getMonth()]}`;
  return `Pekan ${range}`;
}

const cellKey = (staffId: string, day: number) => `${staffId}|${day}`;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {(['MORNING', 'EVENING', 'OFF'] as ShiftKind[]).map((s) => (
        <span key={s} className={`rounded-full px-2.5 py-1 font-medium ${SHIFT_STYLE[s]}`}>
          {SHIFT_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

function RosterBody() {
  const { scopedId, selected, depots, ready } = useDepot();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [editing, setEditing] = useState(false);
  // Local cell state, keyed `${staffId}|${day}` → shift. Seeded from the fetched week.
  const [cells, setCells] = useState<Record<string, ShiftKind>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const drivers = useAsync<Customer[]>(() => api.get(endpoints.auth.drivers, true), []);
  const roster = useAsync<ShiftAssignment[]>(
    () => (scopedId ? api.get(endpoints.roster.week(scopedId, weekStart), true) : Promise.resolve([])),
    [scopedId, weekStart],
  );

  useEffect(() => {
    const next: Record<string, ShiftKind> = {};
    for (const a of roster.data ?? []) next[cellKey(a.staffId, a.day)] = a.shift;
    setCells(next);
  }, [roster.data]);

  // Rows = active drivers, plus anyone already on the roster who isn't in the driver list.
  const staff = useMemo(() => {
    const list = (drivers.data ?? []).map((d) => ({ id: d.id, name: d.fullName ?? d.phone }));
    const seen = new Set(list.map((s) => s.id));
    for (const a of roster.data ?? []) {
      if (!seen.has(a.staffId)) {
        seen.add(a.staffId);
        list.push({ id: a.staffId, name: a.staffName });
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [drivers.data, roster.data]);

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  async function cycle(staffId: string, staffName: string, day: number) {
    if (!editing || !scopedId) return;
    const current = cells[cellKey(staffId, day)] ?? 'OFF';
    const next = CYCLE[current];
    setCells((prev) => ({ ...prev, [cellKey(staffId, day)]: next }));
    setSaveError(null);
    try {
      await api.put(
        endpoints.roster.setCell(),
        { depotId: scopedId, weekStart, staffId, staffName, day, shift: next },
        true,
      );
    } catch (err) {
      setCells((prev) => ({ ...prev, [cellKey(staffId, day)]: current })); // roll back
      setSaveError(err instanceof ApiError ? err.message : 'Gagal menyimpan shift.');
    }
  }

  function exportCsv() {
    const header = ['Staf', ...DAY_LABELS];
    const rows = staff.map((s) => [
      s.name,
      ...DAY_LABELS.map((_, day) => SHIFT_LABEL[cells[cellKey(s.id, day)] ?? 'OFF']),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `jadwal-shift-${weekStart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const loading = roster.loading || drivers.loading;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarBlank size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Jadwal shift kurir</h1>
            {scopedDepot && <p className="text-[12.5px] text-[color:var(--text-muted)]">{scopedDepot.name}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={editing ? 'primary' : 'secondary'} onClick={() => setEditing((v) => !v)}>
            <PencilSimple size={16} weight="bold" className="mr-1.5" />
            {editing ? 'Selesai atur' : 'Atur shift'}
          </Button>
          <Button variant="ghost" onClick={exportCsv} disabled={staff.length === 0}>
            <DownloadSimple size={16} weight="bold" className="mr-1.5" />
            Ekspor jadwal
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setWeekStart((w) => shiftWeek(w, -1))} aria-label="Pekan sebelumnya">
            <CaretLeft size={18} weight="bold" />
          </Button>
          <span className="min-w-[9rem] text-center font-semibold">{weekLabel(weekStart)}</span>
          <Button variant="ghost" onClick={() => setWeekStart((w) => shiftWeek(w, 1))} aria-label="Pekan berikutnya">
            <CaretRight size={18} weight="bold" />
          </Button>
        </div>
        <Legend />
      </div>

      {saveError && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {saveError}
        </p>
      )}

      {ready && depots.length === 0 ? (
        <CenterState title="Belum ada depot" icon={<CalendarBlank size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : loading ? (
        <Skeleton className="h-64 w-full" />
      ) : roster.error ? (
        <ErrorState message={roster.error} onRetry={roster.reload} />
      ) : staff.length === 0 ? (
        <CenterState title="Belum ada kurir" icon={<UsersThree size={40} weight="fill" />}>
          Belum ada kurir aktif untuk dijadwalkan di depot ini.
        </CenterState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-app text-[color:var(--text-muted)]">
                <th className="px-4 py-3 text-left font-semibold">Kurir</th>
                {DAY_LABELS.map((d) => (
                  <th key={d} className="px-2 py-3 text-center font-semibold">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-b border-app last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                        {initials(s.name)}
                      </span>
                      <span className="truncate font-medium">{s.name}</span>
                    </div>
                  </td>
                  {DAY_LABELS.map((_, day) => {
                    const shift = cells[cellKey(s.id, day)] ?? 'OFF';
                    return (
                      <td key={day} className="px-1.5 py-2 text-center">
                        <button
                          type="button"
                          disabled={!editing}
                          onClick={() => cycle(s.id, s.name, day)}
                          className={`w-full rounded-lg px-2 py-1.5 text-xs font-semibold transition ${SHIFT_STYLE[shift]} ${
                            editing ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                          }`}
                          aria-label={`${s.name} ${DAY_LABELS[day]}: ${SHIFT_LABEL[shift]}`}
                        >
                          {SHIFT_LABEL[shift]}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isStaff(customer?.role)) {
    return (
      <CenterState title="Khusus staf depot" icon={<Lock size={40} weight="fill" />}>
        Jadwal shift hanya tersedia untuk staf depot.
      </CenterState>
    );
  }
  return <RosterBody />;
}

export default function ShiftPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
