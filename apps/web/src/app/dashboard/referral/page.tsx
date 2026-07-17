'use client';

import { Gift, Lock, ShareNetwork } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

// TODO: wire to referrals backend depot aggregate (referrals.me is customer-scoped only).
type TopReferrer = { name: string; joined: number; reward: string };
const TOP_REFERRERS: TopReferrer[] = [
  { name: 'Sari Wulandari', joined: 8, reward: 'Rp80.000' },
  { name: 'Budi Santoso', joined: 5, reward: 'Rp50.000' },
  { name: 'Dewi Lestari', joined: 4, reward: 'Rp40.000' },
  { name: 'Andi Pratama', joined: 3, reward: 'Rp30.000' },
];

const STATS: { label: string; value: string }[] = [
  { label: 'Undangan', value: '312' },
  { label: 'Berhasil', value: '128' },
  { label: 'Konversi', value: '41%' },
];

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function ReferralBody() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShareNetwork size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Referral</h1>
            <p className="text-sm text-[color:var(--text-muted)]">&quot;Ajak teman&quot; · aktif</p>
          </div>
        </div>
        <Chip tone="success">Aktif</Chip>
      </div>

      <Card className="flex items-center gap-3 bg-brand-800 p-5" elevated={false}>
        <Gift size={26} weight="fill" className="shrink-0 text-on-brand" />
        <div className="text-on-brand">
          <p className="font-semibold">Pengajak Rp10.000 · diajak Rp10.000</p>
          <p className="text-[12.5px] opacity-80">Kredit masuk otomatis setelah order pertama teman.</p>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {STATS.map((s) => (
          <Card key={s.label} className="flex flex-col gap-1 p-4">
            <span className="text-xs text-[color:var(--text-muted)]">{s.label}</span>
            <span className="text-2xl font-bold tabular-nums">{s.value}</span>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-1 p-5">
        <h2 className="mb-2 font-semibold">Pengajak teratas</h2>
        <ul className="divide-y divide-[color:var(--border)]">
          {TOP_REFERRERS.map((r) => (
            <li key={r.name} className="flex items-center gap-3 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
                {initials(r.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs text-[color:var(--text-muted)]">{r.joined} teman bergabung</p>
              </div>
              <span className="shrink-0 font-bold tabular-nums text-[color:var(--success)]">{r.reward}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Program referral hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <ReferralBody />;
}

export default function ReferralPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
