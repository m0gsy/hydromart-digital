'use client';

import { ArrowsClockwise, Info, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

type Sub = {
  id: string;
  name: string;
  gallons: number;
  cadence: string;
  todayLabel: string;
  paused: boolean;
};

// TODO: wire to subscriptions backend (endpoints.subscriptions.list is customer-scoped,
// not a depot roster; adminSummary is HQ network-wide). Static seed for the depot view.
const ACTIVE = 42;
const PER_MONTH = 560;
const SUBS: Sub[] = [
  { id: 's1', name: 'Siti Rahayu', gallons: 2, cadence: 'Tiap 3 hari · berikutnya hari ini', todayLabel: 'hari ini', paused: false },
  { id: 's2', name: 'Budi Santoso', gallons: 4, cadence: 'Tiap 7 hari · berikutnya hari ini', todayLabel: 'hari ini', paused: false },
  { id: 's3', name: 'Warung Bu Dewi', gallons: 6, cadence: 'Tiap 2 hari · berikutnya hari ini', todayLabel: 'hari ini', paused: false },
  { id: 's4', name: 'Andi Wijaya', gallons: 1, cadence: 'Tiap 5 hari · dijeda pelanggan', todayLabel: 'dijeda', paused: true },
];

const TODAY_COUNT = SUBS.filter((s) => !s.paused).length;

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-4 text-center">
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-xs text-[color:var(--text-muted)]">{label}</p>
    </Card>
  );
}

function SubscriptionsBody() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ArrowsClockwise size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Langganan</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            <span className="tabular-nums">{ACTIVE}</span> aktif ·{' '}
            <span className="tabular-nums">{TODAY_COUNT}</span> jadwal hari ini
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Aktif" value={ACTIVE} />
        <Stat label="Hari ini" value={TODAY_COUNT} />
        <Stat label="Galon / bulan" value={PER_MONTH} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-[color:var(--text-muted)]">Jadwal hari ini</h2>
        {SUBS.map((s) => (
          <Card key={s.id} className="flex items-center gap-3 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
              {s.name.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {s.name} · <span className="tabular-nums">{s.gallons}</span> galon
              </p>
              <p className="text-[12.5px] text-[color:var(--text-muted)]">{s.cadence}</p>
            </div>
            {s.paused ? <Chip tone="amber">Dijeda</Chip> : <Chip tone="success">Auto-order</Chip>}
          </Card>
        ))}
      </section>

      <Card className="flex items-start gap-3 bg-brand-50 p-4" elevated={false}>
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-[12.5px] text-[color:var(--text)]">
          Pesanan langganan dibuat otomatis pada pagi hari jadwal dan langsung masuk antrean
          pengiriman. Pelanggan bisa menjeda kapan saja lewat aplikasi.
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
        Langganan pelanggan hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <SubscriptionsBody />;
}

export default function SubscriptionsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
