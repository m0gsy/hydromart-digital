'use client';

import { CalendarPlus, Drop, Lightning, Lock, Sun, Wrench, type Icon } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { isDepotManager } from '@/lib/roles';

type Status = 'due' | 'soon' | 'healthy' | 'new';

type Equipment = {
  id: string;
  name: string;
  icon: Icon;
  interval: string;
  last: string;
  next: string;
  status: Status;
  daysLeft?: number;
};

// TODO: wire to maintenance backend (equipment service schedule). Static seed.
const EQUIPMENT: Equipment[] = [
  {
    id: 'ro',
    name: 'Filter RO membran',
    icon: Drop,
    interval: 'Servis tiap 3 bulan',
    last: 'terakhir 12 Apr',
    next: 'berikut 12 Jul',
    status: 'due',
  },
  {
    id: 'mesin',
    name: 'Mesin isi ulang',
    icon: Wrench,
    interval: 'Servis tiap 1 bulan',
    last: 'terakhir 20 Jun',
    next: 'berikut 20 Jul',
    status: 'soon',
    daysLeft: 2,
  },
  {
    id: 'genset',
    name: 'Genset cadangan',
    icon: Lightning,
    interval: 'Servis tiap 6 bulan',
    last: 'terakhir 1 Mar',
    next: 'berikut 1 Sep',
    status: 'healthy',
  },
  {
    id: 'uv',
    name: 'Lampu UV',
    icon: Sun,
    interval: 'Servis tiap 12 bulan',
    last: 'baru dipasang 5 Jul',
    next: 'berikut 5 Jul 2027',
    status: 'new',
  },
];

function StatusChip({ item }: { item: Equipment }) {
  switch (item.status) {
    case 'due':
      return <Badge tone="danger">Jatuh tempo</Badge>;
    case 'soon':
      return <Badge tone="warning">{item.daysLeft} hari lagi</Badge>;
    case 'new':
      return <Badge tone="success">Baru</Badge>;
    default:
      return <Badge tone="success">Sehat</Badge>;
  }
}

function MaintenanceBody() {
  const { selected, depots, scopedId } = useDepot();
  const depotName = (selected ?? depots.find((d) => d.id === scopedId))?.name ?? 'Depot';
  const dueCount = EQUIPMENT.filter((e) => e.status === 'due').length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wrench size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Perawatan alat</h1>
            <p className="text-sm text-[color:var(--text-muted)]">
              {depotName} · <span className="tabular-nums">{dueCount}</span> jatuh tempo
            </p>
          </div>
        </div>
        <Button>
          <CalendarPlus size={16} weight="bold" />
          Jadwalkan
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {EQUIPMENT.map((e) => {
          const IconTile = e.icon;
          return (
            <Card key={e.id} className="flex items-center gap-3 p-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <IconTile size={22} weight="fill" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{e.name}</p>
                <p className="text-[12.5px] text-[color:var(--text-muted)]">
                  {e.interval} · {e.last} · {e.next}
                </p>
              </div>
              <StatusChip item={e} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Perawatan alat hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <MaintenanceBody />;
}

export default function MaintenancePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
