'use client';

import { useState } from 'react';
import { ChartBar, Drop, Export, Lock, Truck, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { formatIDR } from '@/lib/format';
import { canViewDashboard, isStaff } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotDailyReport, DepotWeeklyReport } from '@/lib/types';

const DAY_LABEL = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
const today = () => new Date().toISOString().slice(0, 10);

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-xl font-extrabold tabular-nums">{value}</span>
      {hint && <span className="text-[11.5px] text-muted">{hint}</span>}
    </Card>
  );
}

/* ---------- Harian ---------- */
function Harian({ depotId }: { depotId: string }) {
  const [date, setDate] = useState(today());
  const rep = useAsync<DepotDailyReport>(
    () => api.get(endpoints.reports.depotDaily(depotId, date), true),
    [depotId, date],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-extrabold">Laporan harian · {date}</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-app bg-transparent px-3 py-2 text-sm font-medium"
          />
          <Button variant="ghost" onClick={() => undefined}>
            <Export size={16} weight="bold" /> Ekspor & tutup buku
          </Button>
        </div>
      </div>

      {rep.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : rep.error || !rep.data ? (
        <ErrorState message={rep.error ?? 'Gagal memuat laporan.'} onRetry={rep.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Pesanan selesai" value={String(rep.data.orders)} hint="Diproses hari ini" />
            <StatCard label="Pendapatan" value={formatIDR(rep.data.revenueIdr)} />
            <StatCard label="COD disetor" value={rep.data.codCollectedIdr === null ? '—' : formatIDR(rep.data.codCollectedIdr)} hint="Selisih —" />
            <StatCard label="Gagal antar" value={String(rep.data.failedDeliveries)} />
          </div>

          <Card className="overflow-hidden">
            <div className="border-b border-app px-4 py-3 text-sm font-extrabold">Per kurir</div>
            {rep.data.perCourier.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Rincian per kurir belum tersedia untuk depot ini.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 font-semibold">Kurir</th>
                    <th className="px-4 py-2 text-right font-semibold">Selesai</th>
                    <th className="px-4 py-2 text-right font-semibold">Gagal</th>
                    <th className="px-4 py-2 text-right font-semibold">COD</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.data.perCourier.map((c) => (
                    <tr key={c.name} className="border-t border-app">
                      <td className="px-4 py-2.5 font-semibold">{c.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.completed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.failed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatIDR(c.codIdr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-extrabold">
                <Drop size={18} weight="fill" className="text-brand-500" /> Galon
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([
                  ['Retur masuk', rep.data.gallonsReturned],
                  ['Keluar', rep.data.gallonsDelivered],
                  ['Rusak', rep.data.gallonsDamaged],
                ] as [string, number | null][]).map(([label, n]) => (
                  <div key={label} className="rounded-xl bg-[color:var(--surface-soft)] py-3">
                    <div className="text-lg font-extrabold tabular-nums">{n === null ? '—' : n}</div>
                    <div className="text-[11px] text-muted">{label}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="flex items-start gap-3 border-[color:var(--warning)] p-4">
              <Warning size={20} weight="fill" className="mt-0.5 text-[color:var(--warning)]" />
              <div>
                <p className="text-sm font-extrabold">Stok menipis</p>
                <p className="text-[12.5px] text-muted">
                  Pantau stok galon di tab Inventory sebelum tutup buku. Ambang bawah ditandai otomatis.
                </p>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Mingguan ---------- */
function Mingguan({ depotId }: { depotId: string }) {
  const rep = useAsync<DepotWeeklyReport>(
    () => api.get(endpoints.reports.depotWeekly(depotId), true),
    [depotId],
  );

  if (rep.loading) return <Skeleton className="h-72 w-full" />;
  if (rep.error || !rep.data) return <ErrorState message={rep.error ?? 'Gagal memuat laporan.'} onRetry={rep.reload} />;

  const peak = Math.max(1, ...rep.data.revenueByDay.map((d) => d.revenueIdr));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-extrabold">Laporan mingguan</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pesanan" value={String(rep.data.orders)} />
        <StatCard label="Pendapatan" value={formatIDR(rep.data.revenueIdr)} />
        <StatCard label="Rata-rata per hari" value={formatIDR(rep.data.avgPerDayIdr)} />
        <StatCard label="SLA tepat waktu" value={rep.data.slaOnTimePct != null ? `${rep.data.slaOnTimePct}%` : '—'} />
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-extrabold">
          <ChartBar size={18} weight="fill" className="text-brand-500" /> Pendapatan per hari
        </div>
        {rep.data.revenueByDay.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Belum ada pendapatan pekan ini.</p>
        ) : (
          <div className="flex items-end gap-2" style={{ height: 160 }}>
            {rep.data.revenueByDay.map((d) => (
              <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t-md ${d.revenueIdr === peak ? 'bg-brand-600' : 'bg-brand-50'}`}
                  style={{ height: `${Math.round((d.revenueIdr / peak) * 120) + 4}px` }}
                  title={formatIDR(d.revenueIdr)}
                />
                <span className="truncate text-[10px] text-muted">{DAY_LABEL.format(new Date(d.day))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-app px-4 py-3 text-sm font-extrabold">Produk terlaris</div>
        {rep.data.topProducts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Belum ada penjualan.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {rep.data.topProducts.map((p, i) => (
              <li key={p.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-semibold">
                  <span className="mr-2 text-muted tabular-nums">{i + 1}.</span>
                  {p.label}
                </span>
                <span className="tabular-nums text-muted">{p.qty} unit</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {rep.data.topCourier && (
        <Card className="flex items-center gap-3 bg-brand-800 p-4 text-white" elevated={false}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
            <Truck size={22} weight="fill" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Kurir terbaik pekan ini</p>
            <p className="text-base font-extrabold">{rep.data.topCourier.name}</p>
            <p className="text-[12.5px] text-white/80 tabular-nums">
              {rep.data.topCourier.delivered} pengiriman
              {rep.data.topCourier.rating != null && ` · ${rep.data.topCourier.rating.toFixed(1)}★`}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

function Body() {
  const { scopedId, selected } = useDepot();
  const [tab, setTab] = useState<'harian' | 'mingguan'>('harian');

  if (!scopedId) {
    return (
      <CenterState title="Pilih depot" icon={<ChartBar size={40} weight="fill" />}>
        Pilih depot di switcher untuk melihat laporan operasional.
      </CenterState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="inline-flex w-fit rounded-xl bg-[color:var(--surface-soft)] p-1">
        {(['harian', 'mingguan'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition ${
              tab === t ? 'bg-brand-600 text-white' : 'text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {selected && <p className="-mt-2 text-xs text-muted">Depot {selected.name}</p>}
      {tab === 'harian' ? <Harian depotId={scopedId} /> : <Mingguan depotId={scopedId} />}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  // Operators own the depot report screens (design 2d/7d), so isStaff opens the gate
  // alongside the dashboard capability held by managers/HQ.
  if (!isStaff(customer?.role) && !canViewDashboard(customer?.role)) {
    return (
      <CenterState title="Khusus staf depot" icon={<Lock size={40} weight="fill" />}>
        Laporan operasional depot tersedia untuk operator dan manajer depot.
      </CenterState>
    );
  }
  return <Body />;
}

export default function ReportsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
