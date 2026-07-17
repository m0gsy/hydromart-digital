'use client';

import { useState } from 'react';
import { FileText, Lock, Scales } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Button, Card, CenterState, Chip, Money } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

type Claim = 'WRONG_ITEM' | 'NOT_RECEIVED' | 'OVERCHARGE';
type Status = 'TERBUKA' | 'SELESAI';

type Dispute = {
  id: string;
  orderRef: string;
  claimant: string;
  date: string;
  claim: Claim;
  status: Status;
  quote: string;
  billed: number;
  gallons: number;
  courier: string;
  podUrl: string;
};

const CLAIM_LABEL: Record<Claim, string> = {
  WRONG_ITEM: 'Barang salah',
  NOT_RECEIVED: 'Tidak diterima',
  OVERCHARGE: 'Tagihan lebih',
};

// TODO: wire to disputes backend (no dispute service exists yet). Static shape.
const DISPUTES: Dispute[] = [
  {
    id: 'd1',
    orderRef: 'ORD-2418',
    claimant: 'Rina Hapsari',
    date: '16 Jul 2026',
    claim: 'NOT_RECEIVED',
    status: 'TERBUKA',
    quote: 'Katanya sudah dikirim tapi galon tidak pernah sampai ke rumah saya.',
    billed: 42000,
    gallons: 2,
    courier: 'Budi Santoso',
    podUrl: '#',
  },
  {
    id: 'd2',
    orderRef: 'ORD-2401',
    claimant: 'Hendra Wijaya',
    date: '15 Jul 2026',
    claim: 'WRONG_ITEM',
    status: 'TERBUKA',
    quote: 'Pesan galon 19L tapi yang datang botol 600ml sekardus.',
    billed: 21000,
    gallons: 1,
    courier: 'Sari Wulandari',
    podUrl: '#',
  },
  {
    id: 'd3',
    orderRef: 'ORD-2388',
    claimant: 'Maya Sari',
    date: '14 Jul 2026',
    claim: 'OVERCHARGE',
    status: 'SELESAI',
    quote: 'Ditagih ongkir dua kali padahal cuma sekali antar.',
    billed: 63000,
    gallons: 3,
    courier: 'Dewi Lestari',
    podUrl: '#',
  },
];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-xs text-[color:var(--text-muted)]">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function DisputeCard({ dispute, onResolve }: { dispute: Dispute; onResolve: (id: string) => void }) {
  const open = dispute.status === 'TERBUKA';
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold">{dispute.orderRef}</p>
            <Chip tone="outline">{CLAIM_LABEL[dispute.claim]}</Chip>
          </div>
          <p className="text-xs text-[color:var(--text-muted)]">
            {dispute.claimant} · {dispute.date}
          </p>
        </div>
        <Chip tone={open ? 'amber' : 'success'}>{dispute.status}</Chip>
      </div>

      <p className="rounded-lg bg-[color:var(--surface-soft)] p-3 text-[12.5px] italic text-[color:var(--text-muted)]">
        “{dispute.quote}”
      </p>

      <dl className="flex flex-col divide-y divide-[color:var(--border)] rounded-lg border border-app px-3">
        <Fact label="Ditagih">
          <Money amount={dispute.billed} />
        </Fact>
        <Fact label="Bukti antar (PoD)">
          <a href={dispute.podUrl} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
            <FileText size={14} weight="fill" />
            Lihat PoD
          </a>
        </Fact>
        <Fact label="Kurir">{dispute.courier}</Fact>
      </dl>

      {open ? (
        <div className="flex flex-wrap gap-2 border-t border-app pt-3">
          <Button variant="primary" className="flex-1" onClick={() => onResolve(dispute.id)}>
            Refund {dispute.gallons} galon
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => onResolve(dispute.id)}>
            Kirim ulang
          </Button>
          <Button variant="danger" className="flex-1" onClick={() => onResolve(dispute.id)}>
            Tolak
          </Button>
        </div>
      ) : (
        <p className="border-t border-app pt-3 text-xs font-medium text-[color:var(--text-muted)]">
          Sengketa sudah diselesaikan.
        </p>
      )}
    </Card>
  );
}

function DisputesBody() {
  const [disputes, setDisputes] = useState<Dispute[]>(DISPUTES);
  const resolve = (id: string) =>
    setDisputes((prev) => prev.map((d) => (d.id === id ? { ...d, status: 'SELESAI' } : d)));

  const openCount = disputes.filter((d) => d.status === 'TERBUKA').length;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Scales size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Sengketa order</h1>
          <p className="text-sm text-[color:var(--text-muted)]">{openCount} terbuka · klaim pelanggan</p>
        </div>
      </div>

      {disputes.map((d) => (
        <DisputeCard key={d.id} dispute={d} onResolve={resolve} />
      ))}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Sengketa order hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <DisputesBody />;
}

export default function DisputesPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
