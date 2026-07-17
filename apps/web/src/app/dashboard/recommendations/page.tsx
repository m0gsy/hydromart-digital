'use client';

import { ArrowsClockwise, Drop, Info, Lock, Sparkle, Stack } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

// TODO: wire to recommendations backend uptake metrics (recommendations.* has no uptake field).
type Suggestion = { title: string; subtitle: string; uptake: string; icon: Icon };
const SUGGESTIONS: Suggestion[] = [
  {
    title: 'Bundle Air 600ml + galon',
    subtitle: 'Ditawarkan saat checkout galon 19L',
    uptake: '32%',
    icon: Stack,
  },
  {
    title: 'Galon baru untuk deposit',
    subtitle: 'Untuk pelanggan tanpa galon terdaftar',
    uptake: '24%',
    icon: Drop,
  },
  {
    title: 'Aktifkan langganan mingguan',
    subtitle: 'Untuk pelanggan dengan order berulang',
    uptake: '18%',
    icon: ArrowsClockwise,
  },
];

const STATS: { label: string; value: string }[] = [
  { label: 'Ditampilkan', value: '4.820' },
  { label: 'Uptake', value: '26%' },
];

function RecommendationsBody() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Sparkle size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Rekomendasi</h1>
          <p className="text-sm text-[color:var(--text-muted)]">Saran otomatis di app pelanggan</p>
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
        <ul className="divide-y divide-[color:var(--border)]">
          {SUGGESTIONS.map((s) => {
            const Ico = s.icon;
            return (
              <li key={s.title} className="flex items-center gap-3 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Ico size={20} weight="fill" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="text-xs text-[color:var(--text-muted)]">{s.subtitle}</p>
                </div>
                <span className="shrink-0 font-bold tabular-nums text-[color:var(--success)]">{s.uptake}</span>
              </li>
            );
          })}
        </ul>
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
  if (!isDepotManager(customer?.role)) {
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
