'use client';

import { ArrowDown, ArrowUp, BookOpen, Export, Lock, type Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, Chip, Money } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

type Entry = {
  id: string;
  direction: 'in' | 'out';
  label: string;
  detail: string;
  time: string;
  amount: number;
};

const TODAY = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(
  new Date(),
);

// TODO: wire to cashbook backend (depot cash ledger). Static seed.
const OPENING = 1_250_000;
const ENTRIES: Entry[] = [
  { id: 'e1', direction: 'in', label: 'Penjualan galon', detail: 'Order #0231 · tunai', time: '08.15', amount: 60_000 },
  { id: 'e2', direction: 'in', label: 'Isi ulang', detail: 'Order #0232 · QRIS', time: '09.40', amount: 25_000 },
  { id: 'e3', direction: 'out', label: 'Beli tutup galon', detail: 'Toko Makmur', time: '10.05', amount: 85_000 },
  { id: 'e4', direction: 'in', label: 'Setoran kurir', detail: 'Shift pagi · Budi', time: '12.30', amount: 340_000 },
  { id: 'e5', direction: 'out', label: 'Bensin genset', detail: 'SPBU', time: '13.10', amount: 50_000 },
];

const IN = ENTRIES.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
const OUT = ENTRIES.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
const CLOSING = OPENING + IN - OUT;

function StatCard({
  label,
  amount,
  variant,
}: {
  label: string;
  amount: number;
  variant: 'in' | 'out' | 'balance';
}) {
  if (variant === 'balance') {
    return (
      <Card className="flex flex-col gap-1 bg-brand-700 p-4 text-on-brand" elevated={false}>
        <p className="text-xs font-medium opacity-80">{label}</p>
        <Money amount={amount} className="text-lg font-extrabold" />
      </Card>
    );
  }
  const color = variant === 'in' ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]';
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium text-[color:var(--text-muted)]">{label}</p>
      <span className={`text-lg font-extrabold tabular-nums ${color}`}>
        {variant === 'in' ? '+' : '−'}
        <Money amount={amount} />
      </span>
    </Card>
  );
}

function CashbookBody() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Buku kas</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {TODAY} · saldo awal <Money amount={OPENING} className="font-semibold" />
            </p>
          </div>
        </div>
        <Chip tone="tint">Hari ini</Chip>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Masuk" amount={IN} variant="in" />
        <StatCard label="Keluar" amount={OUT} variant="out" />
        <StatCard label="Saldo akhir" amount={CLOSING} variant="balance" />
      </div>

      <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
        {ENTRIES.map((e) => {
          const ArrowIcon: Icon = e.direction === 'in' ? ArrowDown : ArrowUp;
          const isIn = e.direction === 'in';
          return (
            <div key={e.id} className="flex items-center gap-3 p-4">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                  isIn
                    ? 'bg-[color:var(--success-bg)] text-[color:var(--success)]'
                    : 'bg-[color:var(--surface-soft)] text-[color:var(--danger)]'
                }`}
              >
                <ArrowIcon size={16} weight="bold" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{e.label}</p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  {e.time} · {e.detail}
                </p>
              </div>
              <span
                className={`shrink-0 text-sm font-semibold tabular-nums ${
                  isIn ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]'
                }`}
              >
                {isIn ? '+' : '−'}
                <Money amount={e.amount} />
              </span>
            </div>
          );
        })}
      </Card>

      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1">
          <Export size={16} weight="bold" />
          Ekspor CSV
        </Button>
        <Button className="flex-1">Tutup buku hari ini</Button>
      </div>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Buku kas depot hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <CashbookBody />;
}

export default function CashbookPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
