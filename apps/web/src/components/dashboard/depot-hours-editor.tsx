'use client';

import { useState } from 'react';
import { CalendarX, Plus, Trash } from '@phosphor-icons/react';

import { Button, Card, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import type { DepotAdmin, DepotHoliday, DepotHours } from '@/lib/types';

// Day keys match the operatingHours JSON blob the depot-service stores.
const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Senin' },
  { key: 'tue', label: 'Selasa' },
  { key: 'wed', label: 'Rabu' },
  { key: 'thu', label: 'Kamis' },
  { key: 'fri', label: 'Jumat' },
  { key: 'sat', label: 'Sabtu' },
  { key: 'sun', label: 'Minggu' },
];

const DEFAULT_HOURS: DepotHours = { open: '08:00', close: '20:00' };

/** Weekly opening hours + holiday exceptions for one depot (design 11b). PATCHes the depot. */
export function DepotHoursEditor({
  depot,
  onDone,
  onCancel,
}: {
  depot: DepotAdmin;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [hours, setHours] = useState<Record<string, DepotHours>>(depot.operatingHours ?? {});
  const [holidays, setHolidays] = useState<DepotHoliday[]>(depot.holidays ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(key: string) {
    setHours((h) => {
      const next = { ...h };
      if (next[key]) delete next[key];
      else next[key] = { ...DEFAULT_HOURS };
      return next;
    });
  }
  function setTime(key: string, field: 'open' | 'close', value: string) {
    setHours((h) => ({ ...h, [key]: { ...(h[key] ?? DEFAULT_HOURS), [field]: value } }));
  }
  function addHoliday() {
    setHolidays((hs) => [...hs, { date: '', label: '' }]);
  }
  function setHoliday(i: number, field: 'date' | 'label', value: string) {
    setHolidays((hs) => hs.map((h, idx) => (idx === i ? { ...h, [field]: value } : h)));
  }
  function removeHoliday(i: number) {
    setHolidays((hs) => hs.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        endpoints.depots.detail(depot.id),
        { operatingHours: hours, holidays: holidays.filter((h) => h.date.trim() !== '') },
        true,
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menyimpan jam buka.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div>
        <h2 className="font-semibold">Jam buka &amp; hari libur</h2>
        <p className="text-xs text-muted">
          {depot.name} · {depot.code}
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Weekly hours */}
        <div className="flex flex-col">
          <p className="mb-2 text-sm font-bold">Jam buka</p>
          {DAYS.map((d) => {
            const dh = hours[d.key];
            return (
              <div key={d.key} className="flex items-center gap-3 border-t border-app py-2.5 first:border-0">
                <span className="w-16 text-sm font-semibold">{d.label}</span>
                {dh ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      type="time"
                      value={dh.open}
                      onChange={(e) => setTime(d.key, 'open', e.target.value)}
                      className="py-1.5"
                    />
                    <span className="text-muted">–</span>
                    <Input
                      type="time"
                      value={dh.close}
                      onChange={(e) => setTime(d.key, 'close', e.target.value)}
                      className="py-1.5"
                    />
                  </div>
                ) : (
                  <span className="flex-1 text-sm text-muted">Tutup</span>
                )}
                <button
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  aria-pressed={!!dh}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    dh ? 'bg-brand-600' : 'bg-[color:var(--surface-soft)]'
                  }`}
                >
                  <span
                    className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${
                      dh ? 'left-[23px]' : 'left-[3px]'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>

        {/* Holidays */}
        <div className="flex flex-col">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold">Hari libur</p>
            <Button variant="ghost" onClick={addHoliday} className="px-2 py-1 text-xs">
              <Plus size={14} weight="bold" />
              Tambah
            </Button>
          </div>
          {holidays.length === 0 ? (
            <p className="py-4 text-sm text-muted">Belum ada pengecualian jadwal.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {holidays.map((h, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-app p-2">
                  <CalendarX size={18} weight="fill" className="shrink-0 text-amber-600" />
                  <Input
                    type="date"
                    value={h.date}
                    onChange={(e) => setHoliday(i, 'date', e.target.value)}
                    className="py-1.5"
                  />
                  <Input
                    value={h.label ?? ''}
                    onChange={(e) => setHoliday(i, 'label', e.target.value)}
                    placeholder="Keterangan"
                    className="py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => removeHoliday(i)}
                    aria-label="Hapus"
                    className="shrink-0 rounded-lg p-1.5 text-red-600 hover:bg-[color:var(--danger-bg)]"
                  >
                    <Trash size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button onClick={save} loading={busy}>
          Simpan jam &amp; libur
        </Button>
      </div>
    </Card>
  );
}
