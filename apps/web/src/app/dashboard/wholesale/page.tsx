'use client';

import { Lock, Info, Users, Stack } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, Money } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

// ponytail: static tiers — wholesale pricing has no backend yet. TODO: wire to pricing
// backend (extend endpoints.pricing rules with a quantity-tier dimension).
interface WholesaleTier {
  label: string;
  range: string;
  price: number;
  note?: string;
  best?: boolean;
}

const GALON_TIERS: WholesaleTier[] = [
  { label: 'Harga eceran', range: '1–9 galon', price: 19000 },
  { label: 'Grosir kecil', range: '10–49 galon', price: 17500 },
  { label: 'Grosir besar', range: '50+ galon', price: 16000, note: 'TERLARIS B2B', best: true },
];

function TierRow({ tier }: { tier: WholesaleTier }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
        tier.best ? 'border-2 border-brand-500 bg-brand-50' : 'border-app'
      }`}
    >
      <div className="min-w-0">
        <p className="font-semibold">{tier.range}</p>
        <p className="text-xs text-muted">
          {tier.label}
          {tier.note && (
            <>
              {' · '}
              <span className="font-semibold text-brand-700">{tier.note}</span>
            </>
          )}
        </p>
      </div>
      <Money amount={tier.price} className="shrink-0 text-lg font-bold" />
    </div>
  );
}

function WholesaleBody() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Stack size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">Harga borongan</h1>
            <p className="text-sm text-muted">tingkat grosir · pelanggan B2B</p>
          </div>
        </div>
        {/* TODO: wire to pricing backend — opens the tier editor once tiers are persisted. */}
        <Button>Tingkat baru</Button>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Galon 19L</h2>
          <Badge tone="brand">3 tingkat</Badge>
        </div>
        <div className="flex flex-col gap-2.5">
          {GALON_TIERS.map((t) => (
            <TierRow key={t.range} tier={t} />
          ))}
        </div>
      </section>

      <Card className="flex items-center gap-3 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50">
          <Users size={22} weight="fill" className="text-brand-600" />
        </div>
        <div className="min-w-0">
          <p className="text-lg font-bold tabular-nums">4 pelanggan B2B aktif</p>
          <p className="text-xs text-muted">Warung, kantor, dan reseller dengan harga borongan.</p>
        </div>
      </Card>

      <Card className="flex gap-3 bg-[color:var(--surface-soft)] p-4">
        <Info size={20} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-sm text-muted">
          Harga borongan menimpa harga eceran untuk pelanggan B2B. Saat aturan harga dinamis juga
          aktif, <strong className="text-[color:var(--text)]">prioritas tertinggi yang menang</strong>{' '}
          — atur prioritas tingkat borongan di atas aturan diskon agar harga grosir tidak tertimpa.
        </p>
      </Card>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Manajer depot saja" icon={<Lock size={40} weight="fill" />}>
        Harga borongan hanya dapat diatur oleh manajer depot.
      </CenterState>
    );
  }
  return <WholesaleBody />;
}

export default function WholesalePage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
