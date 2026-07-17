'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  Star,
  Target,
  Timer,
  Trophy,
  XCircle,
} from '@phosphor-icons/react';

import { DriverShell } from '@/components/driver/driver-shell';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import type { CourierPerformance } from '@/lib/types';

const DAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const RANGE = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });

/** YYYY-MM-DD of the WIB (UTC+7) Monday `weeksAgo` weeks back. */
function wibMonday(weeksAgo: number): string {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  const daysFromMon = (wib.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - daysFromMon - weeksAgo * 7),
  );
  return monday.toISOString().slice(0, 10);
}

function weekRangeLabel(weekStart: string): string {
  const from = new Date(`${weekStart}T00:00:00+07:00`);
  const to = new Date(from.getTime() + 6 * 24 * 3600 * 1000);
  return `${RANGE.format(from)} – ${RANGE.format(to)}`;
}

function Performance() {
  const router = useRouter();
  const { customer } = useAuth();
  const depotId = customer?.assignedDepotId ?? undefined;
  const [weeksAgo, setWeeksAgo] = useState(0);
  const weekStart = wibMonday(weeksAgo);

  const load = useAsync<CourierPerformance>(
    () => api.get(endpoints.deliveries.performance(weekStart, depotId), true),
    [weekStart, depotId],
  );

  return (
    <div className="space-y-3 px-4 py-5">
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-9 items-center justify-center rounded-xl border border-[color:var(--border)]"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 text-sm font-extrabold">Performa mingguan</div>
        <div className="flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-white px-2.5 py-1.5">
          <button type="button" aria-label="Minggu sebelumnya" onClick={() => setWeeksAgo((w) => w + 1)}>
            <CaretLeft size={13} />
          </button>
          <span className="text-[11.5px] font-bold tabular-nums">{weekRangeLabel(weekStart)}</span>
          <button
            type="button"
            aria-label="Minggu berikutnya"
            disabled={weeksAgo === 0}
            className="disabled:opacity-30"
            onClick={() => setWeeksAgo((w) => Math.max(0, w - 1))}
          >
            <CaretRight size={13} />
          </button>
        </div>
      </header>

      {load.loading ? (
        <Skeleton className="h-96 w-full" />
      ) : load.error || !load.data ? (
        <ErrorState message={load.error ?? 'Gagal memuat'} onRetry={load.reload} />
      ) : (
        <Body p={load.data} />
      )}
    </div>
  );
}

function Body({ p }: { p: CourierPerformance }) {
  const deliveredDelta =
    p.deliveredPrev > 0 ? Math.round(((p.delivered - p.deliveredPrev) / p.deliveredPrev) * 100) : null;
  const ratingDelta =
    p.rating !== null && p.ratingPrev !== null ? Math.round((p.rating - p.ratingPrev) * 10) / 10 : null;
  const maxDay = Math.max(1, ...p.perDay);
  const avgDay = p.delivered === 0 ? 0 : Math.round((p.delivered / 7) * 10) / 10;

  return (
    <>
      {p.rank !== null && (
        <Card className="bg-brand-600 p-4 text-on-brand">
          <div className="flex items-center gap-2">
            <Trophy size={19} weight="fill" className="text-amber-300" />
            <span className="text-xs font-bold opacity-90">Peringkat depot minggu ini</span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tabular-nums">#{p.rank}</span>
            <span className="text-sm opacity-85">dari {p.depotCouriers} kurir</span>
          </div>
        </Card>
      )}

      <div className="flex gap-2.5">
        <Stat value={String(p.delivered)} label="Antar selesai" delta={deltaText(deliveredDelta, '%')} />
        <Stat
          value={p.rating === null ? '—' : p.rating.toLocaleString('id-ID')}
          label="Rating"
          icon={<Star size={16} weight="fill" className="text-amber-500" />}
          delta={ratingDelta === null ? null : deltaText(ratingDelta, '')}
        />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-extrabold">Antar per hari</span>
          <span className="text-[11px] text-[color:var(--muted)]">rata-rata {avgDay.toLocaleString('id-ID')}</span>
        </div>
        <div className="flex h-24 items-end justify-between gap-2">
          {p.perDay.map((n, i) => (
            <div key={DAY_LABELS[i]} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className={`w-full rounded ${n === maxDay && n > 0 ? 'bg-brand-600' : 'bg-brand-100'}`}
                style={{ height: `${Math.round((n / maxDay) * 72) + 4}px` }}
              />
              <span className="text-[10px] font-bold text-[color:var(--muted)]">{DAY_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="px-4 py-1">
        <Row icon={<Timer size={17} weight="fill" />} label="Tepat waktu (SLA)">
          <span className="font-extrabold tabular-nums text-green-600">
            {Math.round(p.onTimeRate * 100)}%
          </span>
        </Row>
        <Row icon={<XCircle size={17} weight="fill" />} label="Gagal antar" divider>
          <span className="font-extrabold tabular-nums">{p.failed}</span>
        </Row>
        <Row icon={<Target size={17} weight="fill" />} label={`Target mingguan · ${p.target}`} divider>
          {p.targetMet ? (
            <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-extrabold text-green-700">
              Tercapai
            </span>
          ) : (
            <span className="text-xs font-bold text-[color:var(--muted)]">
              {p.delivered}/{p.target}
            </span>
          )}
        </Row>
      </Card>
    </>
  );
}

function deltaText(v: number | null, unit: string): string | null {
  if (v === null || v === 0) return null;
  return `${v > 0 ? '↑' : '↓'} ${Math.abs(v).toLocaleString('id-ID')}${unit}`;
}

function Stat({
  value,
  label,
  delta,
  icon,
}: {
  value: string;
  label: string;
  delta: string | null;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="flex-1 p-3.5">
      <div className="flex items-center gap-1">
        {icon}
        <span className="text-xl font-extrabold tabular-nums">{value}</span>
      </div>
      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--muted)]">
        {label}
      </div>
      {delta && <div className="mt-0.5 text-[11px] font-bold text-green-600">{delta}</div>}
    </Card>
  );
}

function Row({
  icon,
  label,
  divider,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between py-3 ${divider ? 'border-t border-[color:var(--border)]' : ''}`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-brand-700">{icon}</span>
        {label}
      </span>
      {children}
    </div>
  );
}

export default function DriverPerformancePage() {
  return (
    <DriverShell nav={false}>
      <Performance />
    </DriverShell>
  );
}
