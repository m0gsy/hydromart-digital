'use client';

import { Lock, Star } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { isDepotManager } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { DepotRatingsReport } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const RELATIVE = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });

/** Trailing-30-day window [now-30d, now). */
function window30d(): { from: string; to: string } {
  const now = Date.now();
  return { from: new Date(now - 30 * DAY_MS).toISOString(), to: new Date(now).toISOString() };
}

function relativeDay(iso: string): string {
  const days = Math.round((Date.parse(iso) - Date.now()) / DAY_MS);
  return RELATIVE.format(days, 'day');
}

// Star buckets rendered high→low; 1–2★ show in the danger colour.
const STAR_ROWS: (keyof DepotRatingsReport['distribution'])[] = ['5', '4', '3', '2', '1'];

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          weight="fill"
          className={i <= value ? 'text-amber-500' : 'text-[color:var(--surface-soft)]'}
        />
      ))}
    </div>
  );
}

function RatingsView({ data }: { data: DepotRatingsReport }) {
  const max = Math.max(...STAR_ROWS.map((s) => data.distribution[s]), 1);
  const average = data.average ?? 0;

  return (
    <>
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex flex-col items-center gap-1 sm:w-40">
          <p className="text-5xl font-extrabold tabular-nums">
            {data.average === null ? '—' : average.toLocaleString('id-ID')}
          </p>
          <Stars value={Math.round(average)} size={18} />
          <p className="text-xs text-[color:var(--text-muted)]">dari 5,0</p>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          {STAR_ROWS.map((s) => {
            const count = data.distribution[s];
            const low = s === '1' || s === '2';
            return (
              <div key={s} className="flex items-center gap-3">
                <span className="w-8 shrink-0 text-right text-xs font-medium text-[color:var(--text-muted)]">
                  {s}★
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
                  <div
                    className={low ? 'h-full rounded-full' : 'h-full rounded-full bg-amber-500'}
                    style={{
                      width: `${(count / max) * 100}%`,
                      ...(low ? { background: 'var(--danger)' } : {}),
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-[color:var(--text-muted)]">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {data.recent.length === 0 ? (
        <CenterState title="Belum ada ulasan" icon={<Star size={40} weight="fill" />}>
          Belum ada ulasan pelanggan untuk depot ini dalam 30 hari terakhir.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-3">
          {data.recent.map((r, i) => (
            <Card key={`${r.createdAt}-${i}`} className="flex gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
                {r.customerName.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{r.customerName}</p>
                  <span className="text-xs text-[color:var(--text-muted)]">
                    {relativeDay(r.createdAt)}
                  </span>
                </div>
                <Stars value={r.stars} />
                {r.comment && (
                  <p className="mt-1.5 text-sm text-[color:var(--text)]">“{r.comment}”</p>
                )}
                {r.stars <= 3 && (
                  <button
                    type="button"
                    className="mt-2 text-sm font-semibold text-brand-600 hover:underline"
                  >
                    Balas →
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function RatingsBody() {
  const { scopedId, selected } = useDepot();
  const { from, to } = window30d();
  const data = useAsync<DepotRatingsReport | null>(
    () =>
      scopedId
        ? api.get<DepotRatingsReport>(endpoints.reports.depotRatings(scopedId, { from, to }), true)
        : Promise.resolve(null),
    [scopedId, from, to],
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Star size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Rating pelanggan</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {selected ? `Depot ${selected.name} · ` : ''}
            <span className="tabular-nums">{data.data?.count ?? 0}</span> ulasan · 30 hari
          </p>
        </div>
      </div>

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <CenterState title="Pilih depot" icon={<Star size={40} weight="fill" />}>
          Pilih depot di switcher untuk melihat rating pelanggan.
        </CenterState>
      ) : (
        <RatingsView data={data.data} />
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Rating & ulasan pelanggan hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <RatingsBody />;
}

export default function RatingsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
