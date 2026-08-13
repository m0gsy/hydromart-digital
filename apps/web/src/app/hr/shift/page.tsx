'use client';

import { useState } from 'react';

import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorState, Field, Input, LoadError, SectionHeader, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import {
  WEEKDAY_LABEL,
  fmtDate,
  rotationShiftForDay,
  type Employee,
  type Shift,
  type ShiftAssignment,
  type ShiftRotation,
} from '@/lib/hr';
import { canManageHr } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { todayWib } from '@/lib/wib';

/**
 * The roster, kept apart from /hr/calendar (holidays) and from the shift catalogue itself.
 * Assigning is append-only: a new row supersedes the old one, and the old one stays readable
 * because a disputed late deduction has to be answerable months later.
 */
export default function ShiftPage() {
  const { customer } = useAuth();
  const isAdmin = canManageHr(customer?.role);

  const shifts = useAsync<Shift[]>(() => api.get<Shift[]>(endpoints.hr.shifts(), true), []);
  const rotations = useAsync<ShiftRotation[]>(
    () => api.get<ShiftRotation[]>(endpoints.hr.shiftRotations(), true),
    [],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionHeader
        title="Shift & Rotasi"
        subtitle="Jadwal kerja per karyawan. Absensi menilai terlambat terhadap shift karyawan, bukan shift depot."
      />

      {/* Both panels below take their shift list from here, and every shift dropdown in
          them is empty without it — which reads as a depot that defined no shifts, the
          same thing attendance uses to decide who was late. */}
      {shifts.error && <LoadError onRetry={shifts.reload} />}

      <Rotations shifts={shifts.data ?? []} rotations={rotations} isAdmin={isAdmin} />

      <Assignments shifts={shifts.data ?? []} rotations={rotations.data ?? []} isAdmin={isAdmin} />
    </div>
  );
}

function Rotations({
  shifts,
  rotations,
  isAdmin,
}: {
  shifts: Shift[];
  rotations: ReturnType<typeof useAsync<ShiftRotation[]>>;
  isAdmin: boolean;
}) {
  const { depots } = useDepot();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [depotId, setDepotId] = useState('');
  const [pattern, setPattern] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const shiftName = (id: string | null) =>
    id ? (shifts.find((s) => s.id === id)?.name ?? 'shift terhapus') : 'Libur';

  async function create() {
    if (!name.trim()) {
      toast('Isi nama rotasi', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.createShiftRotation,
        {
          name: name.trim(),
          ...(depotId ? { depotId } : {}),
          // Blank select = day off; the server normalises it to null either way.
          pattern: Object.fromEntries(
            WEEKDAY_LABEL.map((_, d) => [String(d), pattern[String(d)] || null]),
          ),
        },
        true,
      );
      toast('Rotasi dibuat');
      setName('');
      setPattern({});
      rotations.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal membuat rotasi', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(r: ShiftRotation) {
    try {
      await api.patch(endpoints.hr.updateShiftRotation(r.id), { active: !r.active }, true);
      rotations.reload();
    } catch {
      toast('Gagal mengubah rotasi', 'error');
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Pola Rotasi Mingguan</h2>

      {rotations.loading && <Skeleton className="h-24" />}
      {rotations.error && <ErrorState message={rotations.error} onRetry={rotations.reload} />}
      {rotations.data && (
        <ul className="divide-y divide-[color:var(--border)]">
          {rotations.data.length === 0 && (
            <li className="py-2 text-sm text-muted">Belum ada pola rotasi.</li>
          )}
          {rotations.data.map((r) => (
            <li key={r.id} className="space-y-1 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <b>{r.name}</b>
                  <Badge tone={r.active ? 'success' : 'neutral'}>
                    {r.active ? 'Aktif' : 'Nonaktif'}
                  </Badge>
                  <span className="text-xs text-muted">
                    {r.depotId
                      ? (depots.find((d) => d.id === r.depotId)?.code ?? 'depot')
                      : 'semua depot'}
                  </span>
                </span>
                {isAdmin && (
                  <Button variant="ghost" onClick={() => toggle(r)}>
                    {r.active ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted">
                {WEEKDAY_LABEL.map(
                  (label, d) => `${label}: ${shiftName(rotationShiftForDay(r.pattern, d))}`,
                ).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div className="space-y-3 border-t border-app pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nama rotasi">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rotasi Gudang"
              />
            </Field>
            <Field label="Depot">
              <select
                value={depotId}
                onChange={(e) => setDepotId(e.target.value)}
                className="surface-elevated w-full rounded-lg border border-app px-3 py-2.5 text-sm"
              >
                <option value="">Semua depot</option>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {WEEKDAY_LABEL.map((label, d) => (
              <Field key={d} label={label}>
                <select
                  value={pattern[String(d)] ?? ''}
                  onChange={(e) => setPattern({ ...pattern, [String(d)]: e.target.value })}
                  className="surface-elevated w-full rounded-lg border border-app px-3 py-2.5 text-sm"
                >
                  <option value="">Libur</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.startTime})
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <Button onClick={create} loading={saving}>
            Buat Rotasi
          </Button>
        </div>
      )}
    </Card>
  );
}

function Assignments({
  shifts,
  rotations,
  isAdmin,
}: {
  shifts: Shift[];
  rotations: ShiftRotation[];
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [mode, setMode] = useState<'shift' | 'rotation'>('shift');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState(todayWib());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const staff = useAsync<{ rows: Employee[] }>(
    () =>
      api.get<{ rows: Employee[] }>(
        endpoints.hr.employees({ status: 'ACTIVE', pageSize: 100 }),
        true,
      ),
    [],
  );
  const history = useAsync<ShiftAssignment[]>(
    () =>
      employeeId
        ? api.get<ShiftAssignment[]>(endpoints.hr.shiftAssignments(employeeId), true)
        : Promise.resolve([]),
    [employeeId],
  );

  const label = (a: ShiftAssignment) => {
    if (a.shiftId) return shifts.find((s) => s.id === a.shiftId)?.name ?? 'shift terhapus';
    if (a.rotationId) return rotations.find((r) => r.id === a.rotationId)?.name ?? 'rotasi terhapus';
    // Neither is set. The B2 migration cleared the shift id on rows that named a shift
    // somebody had deleted, and wrote which one into the note — so this is not "rotasi
    // terhapus", which is what the old two-branch version called it.
    return 'tanpa shift — lihat catatan';
  };

  async function assign() {
    if (!employeeId || !targetId) {
      toast('Pilih karyawan dan shift/rotasi', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.createShiftAssignment,
        {
          employeeId,
          ...(mode === 'shift' ? { shiftId: targetId } : { rotationId: targetId }),
          effectiveFrom: new Date(from).toISOString(),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        true,
      );
      toast('Penugasan shift dicatat');
      setNote('');
      history.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Gagal menugaskan', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">Penugasan Karyawan</h2>
      <p className="text-xs text-muted">
        Penugasan bersifat tambah — penugasan lama tetap tersimpan sebagai riwayat. Karyawan tanpa
        penugasan tetap dinilai terhadap shift depot seperti sebelumnya.
      </p>

      <Field label="Karyawan">
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="surface-elevated w-full rounded-lg border border-app px-3 py-2.5 text-sm"
        >
          <option value="">Pilih karyawan</option>
          {(staff.data?.rows ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.employeeCode} · {e.fullName}
            </option>
          ))}
        </select>
        {staff.error && <LoadError onRetry={staff.reload} />}
      </Field>

      {employeeId && (
        <>
          {history.loading ? (
            <Skeleton className="h-16" />
          ) : history.error ? (
            // "Belum pernah ditugaskan — memakai shift depot" decides which hours this
            // person's lateness is graded against. It must not be what an outage looks like.
            <LoadError onRetry={history.reload} />
          ) : (
            <ol className="space-y-1 text-sm">
              {(history.data ?? []).length === 0 && (
                <li className="text-muted">Belum pernah ditugaskan — memakai shift depot.</li>
              )}
              {(history.data ?? []).map((a) => (
                <li key={a.id} className="text-muted">
                  <b className="text-app">{label(a)}</b> · sejak {fmtDate(a.effectiveFrom)}
                  {a.note ? ` · ${a.note}` : ''}
                </li>
              ))}
            </ol>
          )}

          {isAdmin && (
            <div className="grid gap-3 border-t border-app pt-4 sm:grid-cols-2">
              <Field label="Jenis">
                <select
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as 'shift' | 'rotation');
                    setTargetId('');
                  }}
                  className="surface-elevated w-full rounded-lg border border-app px-3 py-2.5 text-sm"
                >
                  <option value="shift">Shift tetap</option>
                  <option value="rotation">Rotasi mingguan</option>
                </select>
              </Field>
              <Field label={mode === 'shift' ? 'Shift' : 'Rotasi'}>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="surface-elevated w-full rounded-lg border border-app px-3 py-2.5 text-sm"
                >
                  <option value="">Pilih…</option>
                  {mode === 'shift'
                    ? shifts.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.startTime})
                        </option>
                      ))
                    : rotations
                        .filter((r) => r.active)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                </select>
              </Field>
              <Field label="Berlaku mulai">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Catatan (opsional)">
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="col-span-full">
                <Button onClick={assign} loading={saving}>
                  Tugaskan
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
