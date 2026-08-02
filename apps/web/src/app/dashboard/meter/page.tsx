'use client';

import { useState } from 'react';
import { Drop, Gauge, Info, Lock, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canRecordMeterReading, canViewMeterReading } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { MeterHistoryRow, MeterReconciliation } from '@/lib/types';

const TODAY = new Date().toISOString().slice(0, 10);

const num = (v: number | null | undefined, digits = 0): string =>
  v == null ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: digits });

/** A metric that is null because it is not knowable yet must read "—", never 0. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'danger' | 'plain';
}) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <span className="text-xs text-[color:var(--text-muted)]">{label}</span>
      <span
        className={`text-3xl font-bold tabular-nums ${
          tone === 'danger' ? 'text-[color:var(--danger)]' : ''
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-[color:var(--text-muted)]">{hint}</span>
    </Card>
  );
}

/** Bare CSS bar chart — the variance history does not warrant a charting library. */
function VarianceChart({ rows }: { rows: MeterHistoryRow[] }) {
  const withVariance = rows.filter((r) => r.varianceLiters != null);
  if (withVariance.length === 0) {
    return (
      <p className="py-3 text-sm text-[color:var(--text-muted)]">
        Belum ada hari yang meterannya sudah ditutup.
      </p>
    );
  }
  const peak = Math.max(...withVariance.map((r) => Math.abs(r.varianceLiters!)), 1);
  return (
    <ul className="flex flex-col gap-2">
      {withVariance.map((r) => {
        const v = r.varianceLiters!;
        return (
          <li key={r.day} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs tabular-nums text-[color:var(--text-muted)]">
              {r.day.slice(5)}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--border)]">
              <div
                className={`h-full rounded-full ${v < 0 ? 'bg-[color:var(--danger)]' : 'bg-brand-500'}`}
                style={{ width: `${(Math.abs(v) / peak) * 100}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums">
              {v > 0 ? '+' : ''}
              {num(v)} L
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MeterBody() {
  const { customer } = useAuth();
  const { selected, depots, scopedId } = useDepot();
  const depot = selected ?? depots.find((d) => d.id === scopedId) ?? depots[0] ?? null;
  const writable = canRecordMeterReading(customer?.role);

  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [sourceOpening, setSourceOpening] = useState('');
  const [sourceClosing, setSourceClosing] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const day = useAsync<MeterReconciliation | null>(
    () => (depot ? api.get(endpoints.reports.meterDay(depot.id, TODAY), true) : Promise.resolve(null)),
    [depot?.id],
  );
  const history = useAsync<MeterHistoryRow[]>(
    () => (depot ? api.get(endpoints.reports.meterHistory(depot.id), true) : Promise.resolve([])),
    [depot?.id],
  );

  const data = day.data;
  const reading = data?.reading ?? null;

  async function save(fields: Record<string, number>) {
    if (!depot) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(endpoints.reports.meterSave(depot.id, TODAY), fields, true);
      setOpening('');
      setClosing('');
      setSourceOpening('');
      setSourceClosing('');
      day.reload();
      history.reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Gagal menyimpan meteran.');
    } finally {
      setSaving(false);
    }
  }

  const parsed = (v: string): number | null => {
    const n = Number(v.replace(',', '.'));
    return v.trim() === '' || Number.isNaN(n) ? null : n;
  };

  const openingValue = parsed(opening);
  const closingValue = parsed(closing);
  const sourceOpeningValue = parsed(sourceOpening);
  const sourceClosingValue = parsed(sourceClosing);
  const nothingToSave =
    openingValue === null &&
    closingValue === null &&
    sourceOpeningValue === null &&
    sourceClosingValue === null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Gauge size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Meteran air</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {depot?.name ?? 'Pilih depot'} · {TODAY}
          </p>
        </div>
      </div>

      {writable && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="font-semibold">Catat meteran</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--text-muted)]">Meteran pagi (m³)</span>
              <Input
                inputMode="decimal"
                placeholder={reading ? String(reading.openingM3) : '1245.320'}
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--text-muted)]">Meteran sore (m³)</span>
              <Input
                inputMode="decimal"
                placeholder={reading?.closingM3 != null ? String(reading.closingM3) : '1247.920'}
                value={closing}
                onChange={(e) => setClosing(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--text-muted)]">Air baku pagi (m³, opsional)</span>
              <Input
                inputMode="decimal"
                value={sourceOpening}
                onChange={(e) => setSourceOpening(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-[color:var(--text-muted)]">Air baku sore (m³, opsional)</span>
              <Input
                inputMode="decimal"
                value={sourceClosing}
                onChange={(e) => setSourceClosing(e.target.value)}
              />
            </label>
          </div>
          {saveError && <p className="text-sm text-[color:var(--danger)]">{saveError}</p>}
          <Button
            disabled={saving || nothingToSave || !depot}
            onClick={() =>
              save({
                ...(openingValue !== null ? { openingM3: openingValue } : {}),
                ...(closingValue !== null ? { closingM3: closingValue } : {}),
                ...(sourceOpeningValue !== null ? { sourceOpeningM3: sourceOpeningValue } : {}),
                ...(sourceClosingValue !== null ? { sourceClosingM3: sourceClosingValue } : {}),
              })
            }
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </Button>
          <p className="text-xs text-[color:var(--text-muted)]">
            Isi angka pagi saat buka, angka sore saat tutup. Form yang sama dipakai dua kali.
          </p>
        </Card>
      )}

      {day.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : day.error ? (
        <ErrorState message={day.error} onRetry={day.reload} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat
              label="Air keluar (meteran)"
              value={data?.meterLiters != null ? `${num(data.meterLiters)} L` : '—'}
              hint={
                data?.meterLiters != null
                  ? `${num(reading?.openingM3, 3)} → ${num(reading?.closingM3, 3)} m³`
                  : 'meteran sore belum dicatat'
              }
            />
            <Stat
              label="Air terjual (tercatat)"
              value={`${num(data?.soldLiters)} L`}
              hint={`${num(data?.gallonsDelivered)} galon terkirim · ${formatIDR(data?.revenueIdr ?? 0)}`}
            />
            <Stat
              label="Selisih"
              value={
                data?.varianceLiters != null
                  ? `${data.varianceLiters > 0 ? '+' : ''}${num(data.varianceLiters)} L`
                  : '—'
              }
              hint={
                data?.varianceGallons != null
                  ? `± ${num(Math.abs(data.varianceGallons), 1)} galon setara (acuan ${num(
                      (data.referenceVolumeMl ?? 0) / 1000,
                    )} L)`
                  : 'belum bisa dibandingkan'
              }
              tone={data?.overTolerance ? 'danger' : 'plain'}
            />
            <Stat
              label="Nilai selisih"
              value={data?.varianceIdr != null ? formatIDR(data.varianceIdr) : '—'}
              hint={
                data?.varianceIdr != null
                  ? 'dihitung dari omzet per galon hari ini'
                  : 'belum ada galon terkirim hari ini'
              }
              tone={data?.overTolerance ? 'danger' : 'plain'}
            />
          </div>

          {data?.roYieldPct != null && (
            <Card className="flex items-center justify-between p-5">
              <div>
                <p className="font-semibold">Rendemen RO</p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  air hasil dibanding air baku
                </p>
              </div>
              <span className="text-3xl font-bold tabular-nums">{num(data.roYieldPct, 1)}%</span>
            </Card>
          )}

          {data != null && data.unmeasuredLines > 0 && (
            <Card className="flex items-start gap-3 bg-brand-50 p-4">
              <Warning size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
              <p className="text-[12.5px] text-brand-800/80">
                <strong>{data.unmeasuredLines} baris pesanan</strong> hari ini belum punya isi liter,
                jadi tidak ikut dihitung. Isi kolom volume produknya di katalog supaya selisih ini
                akurat.
              </p>
            </Card>
          )}

          {data?.overTolerance && (
            <Card className="flex items-start gap-3 border border-[color:var(--danger)] p-4">
              <Warning size={22} weight="fill" className="mt-0.5 shrink-0 text-[color:var(--danger)]" />
              <p className="text-[12.5px]">
                Selisih melewati ambang {num(data.toleranceLiters)} liter. Cek galon yang keluar
                tanpa tercatat, kebocoran, atau salah ketik angka meteran.
              </p>
            </Card>
          )}

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Drop size={18} weight="fill" className="text-brand-500" />
              Riwayat selisih
            </h2>
            {history.loading ? (
              <Skeleton className="h-32 w-full" />
            ) : history.error ? (
              <ErrorState message={history.error} onRetry={history.reload} />
            ) : (
              <VarianceChart rows={history.data ?? []} />
            )}
          </Card>
        </>
      )}

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Info size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <p className="text-[12.5px] text-brand-800/80">
          Perbandingan ini cocok untuk depot yang mengisi galon saat ada penjualan. Kalau depot
          mengisi stok galon lebih dulu lalu menjualnya esok hari, meteran hari ini memang tidak akan
          sama dengan penjualan hari ini.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canViewMeterReading(customer?.role)) {
    return (
      <CenterState title="Akses terbatas" icon={<Lock size={40} weight="fill" />}>
        Rekonsiliasi meteran air hanya untuk staf depot ke atas.
      </CenterState>
    );
  }
  return <MeterBody />;
}

export default function MeterPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
