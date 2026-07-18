'use client';

import { Info, Lock, Sparkle } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Recommendation } from '@/lib/types';

// ponytail: no recommendation-uptake metrics endpoint — static. recommendation-service
// exposes trending products + a heuristic score, but no "shown/uptake" telemetry.
const STATS: { label: string; value: string }[] = [
  { label: 'Ditampilkan', value: '4.820' },
  { label: 'Uptake', value: '26%' },
];

function RecommendationsBody() {
  const { scopedId, selected, depots, ready } = useDepot();
  // REAL — depot-scoped trending products from recommendation-service.
  const trending = useAsync<Recommendation[]>(
    () => (scopedId ? api.get(endpoints.recommendations.trending({ depotId: scopedId, limit: 6 }), true) : Promise.resolve([])),
    [scopedId],
  );

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;
  const items = trending.data ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Sparkle size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Rekomendasi</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {scopedDepot ? `${scopedDepot.name} · ` : ''}Saran otomatis di app pelanggan
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {STATS.map((s) => (
          <Card key={s.label} className="flex flex-col gap-1 p-4">
            <span className="text-xs text-[color:var(--text-muted)]">{s.label}</span>
            <span className="text-2xl font-bold tabular-nums">{s.value}</span>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-1 p-5">
        <h2 className="mb-2 font-semibold">Saran teratas</h2>
        {ready && depots.length === 0 ? (
          <CenterState title="Belum ada depot" icon={<Sparkle size={40} weight="fill" />}>
            Belum ada depot yang dikonfigurasi.
          </CenterState>
        ) : trending.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : trending.error ? (
          <ErrorState message={trending.error} onRetry={trending.reload} />
        ) : items.length === 0 ? (
          <CenterState title="Belum ada tren" icon={<Sparkle size={40} weight="fill" />}>
            Belum ada produk yang cukup laku untuk jadi tren di depot ini.
          </CenterState>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {items.map((r, i) => (
              <li key={r.productId} className="flex items-center gap-3 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold tabular-nums text-brand-600">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="text-xs text-[color:var(--text-muted)]">
                    SKU {r.sku} · {r.unit}
                  </p>
                </div>
                {/* REAL — heuristic trending score from recommendation-service. */}
                <span className="shrink-0 font-bold tabular-nums text-[color:var(--success)]">
                  {Math.round(r.score)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Info size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <p className="text-[12.5px] text-brand-800/80">
          Rekomendasi dihasilkan otomatis dari pola order pelanggan — produk yang sering dibeli
          bersama, deposit galon yang belum aktif, dan kandidat langganan.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!can('depotAdmin', customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Rekomendasi cross-sell hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <RecommendationsBody />;
}

export default function RecommendationsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
