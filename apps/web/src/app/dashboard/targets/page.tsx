'use client';

import { Lightbulb, Lock, Target } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

type Goal = {
  label: string;
  value: string;
  target: string;
  pct: number;
  /** below pace → amber track fill, otherwise on-brand. */
  behind: boolean;
  caption: string;
};

// TODO: wire to targets backend (dashboard-service depot goals). Static shape for now.
const GOALS: Goal[] = [
  {
    label: 'Pendapatan',
    value: 'Rp71jt',
    target: 'Rp130jt',
    pct: 55,
    behind: false,
    caption: 'Sesuai jalur untuk target bulan ini.',
  },
  {
    label: 'Order terkirim',
    value: '1.402',
    target: '2.600',
    pct: 54,
    behind: false,
    caption: 'Sedikit di atas pace harian.',
  },
  {
    label: 'SLA on-time',
    value: '94%',
    target: '96%',
    pct: 94,
    behind: true,
    caption: 'Di bawah target — pantau rute sore.',
  },
  {
    label: 'Pelanggan baru',
    value: '38',
    target: '60',
    pct: 63,
    behind: false,
    caption: 'Di atas pace, pertahankan promo.',
  },
];

const MONTH = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date());
const DAY = new Date().getDate();

function GoalBar({ goal }: { goal: Goal }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{goal.label}</span>
        <span className="text-sm tabular-nums text-[color:var(--text-muted)]">
          <strong className="text-[color:var(--text)]">{goal.value}</strong> / {goal.target}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
        <div
          className={`h-full rounded-full ${goal.behind ? 'bg-amber-500' : 'bg-brand-600'}`}
          style={{ width: `${Math.min(goal.pct, 100)}%` }}
        />
      </div>
      <p className={`text-xs ${goal.behind ? 'text-[color:var(--danger)]' : 'text-[color:var(--text-muted)]'}`}>
        {goal.caption}
      </p>
    </div>
  );
}

function TargetsBody() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Target size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Target depot</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {MONTH} · hari ke-{DAY} dari 31
          </p>
        </div>
      </div>

      <Card className="flex flex-col gap-5 p-5">
        {GOALS.map((g) => (
          <GoalBar key={g.label} goal={g} />
        ))}
      </Card>

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Lightbulb size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <div>
          <p className="font-semibold text-brand-800">Insight</p>
          <p className="text-[12.5px] text-brand-800/80">
            SLA on-time tertinggal 2 poin dari target. Fokuskan kurir tambahan di slot sore untuk
            mengejar target pendapatan yang masih on-track.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Target & goals depot hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <TargetsBody />;
}

export default function TargetsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
