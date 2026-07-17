'use client';

import { useState } from 'react';
import { Check, Info, Lock, Minus, ClipboardText } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

type ItemState = 'done' | 'partial' | 'pending';
type Item = { id: string; title: string; subtext: string; state: ItemState };

// TODO: wire to handover backend (shift handover checklist). Static seed.
const INITIAL_ITEMS: Item[] = [
  { id: 'h1', title: 'Rekap kas & setoran COD', subtext: 'Cocokkan kas fisik dengan sistem.', state: 'done' },
  { id: 'h2', title: 'Stok galon & air isi ulang', subtext: 'Catat sisa stok akhir shift.', state: 'done' },
  { id: 'h3', title: 'Order tertunda', subtext: '2 order belum terkirim, dijadwalkan sore.', state: 'partial' },
  { id: 'h4', title: 'Kendaraan & aset', subtext: 'Cek kondisi motor & galon pinjaman.', state: 'done' },
  { id: 'h5', title: 'Catatan khusus untuk shift sore', subtext: 'Tulis hal yang perlu ditindaklanjuti.', state: 'pending' },
];

const NEXT_STATE: Record<ItemState, ItemState> = { pending: 'partial', partial: 'done', done: 'pending' };

function StateMark({ state }: { state: ItemState }) {
  if (state === 'done') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-brand-600 text-on-brand">
        <Check size={14} weight="bold" />
      </span>
    );
  }
  if (state === 'partial') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-amber-500 text-white">
        <Minus size={14} weight="bold" />
      </span>
    );
  }
  return <span className="size-6 rounded-full border-2 border-app" />;
}

function HandoverBody() {
  const { customer } = useAuth();
  const [items, setItems] = useState<Item[]>(INITIAL_ITEMS);

  // Tap cycles pending → partial → done → pending.
  const cycle = (id: string) =>
    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, state: NEXT_STATE[it.state] } : it,
      ),
    );

  const doneCount = items.filter((it) => it.state === 'done').length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <ClipboardText size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Serah terima shift</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            Pagi → Sore · {customer?.fullName ?? 'Manajer'} → Sari
          </p>
        </div>
      </div>

      <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => cycle(it.id)}
            className="flex items-center gap-3 p-4 text-left"
          >
            <StateMark state={it.state} />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${it.state === 'done' ? 'text-[color:var(--text-muted)]' : ''}`}>
                {it.title}
              </p>
              <p className="text-[12.5px] text-[color:var(--text-muted)]">{it.subtext}</p>
            </div>
          </button>
        ))}
      </Card>

      <Card className="flex items-start gap-3 bg-brand-50 p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-700" />
        <p className="text-[12.5px] text-brand-800">
          {doneCount} dari {items.length} selesai — lengkapi sisa item sebelum menandatangani serah terima.
        </p>
      </Card>

      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1">
          Simpan draf
        </Button>
        <Button className="flex-1">Tandatangani serah terima</Button>
      </div>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Checklist serah terima shift hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <HandoverBody />;
}

export default function HandoverPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
