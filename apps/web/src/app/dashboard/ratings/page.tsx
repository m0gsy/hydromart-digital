'use client';

import { Lock, Star } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { isDepotManager } from '@/lib/roles';

type Review = {
  id: string;
  name: string;
  stars: number;
  quote: string;
  when: string;
};

// TODO: wire to order-ratings backend (no depot-scoped ratings list endpoint yet;
// orders.review is per-order + customer-scoped). Static seed.
const AVERAGE = 4.7;
const TOTAL = 128;
const DISTRIBUTION: { stars: string; count: number }[] = [
  { stars: '5', count: 92 },
  { stars: '4', count: 24 },
  { stars: '3', count: 8 },
  { stars: '1-2', count: 4 },
];

const REVIEWS: Review[] = [
  { id: 'r1', name: 'Siti Rahayu', stars: 5, quote: 'Kurir ramah, galon datang cepat. Mantap!', when: '2 hari lalu' },
  { id: 'r2', name: 'Budi Santoso', stars: 5, quote: 'Air jernih, harga bersahabat. Langganan terus.', when: '3 hari lalu' },
  { id: 'r3', name: 'Dewi Lestari', stars: 4, quote: 'Bagus, tapi pengiriman agak telat 15 menit.', when: '5 hari lalu' },
  { id: 'r4', name: 'Andi Wijaya', stars: 2, quote: 'Galon bocor sedikit waktu diterima, tolong dicek.', when: '1 minggu lalu' },
];

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} dari 5 bintang`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          weight="fill"
          className={i <= value ? 'text-amber-500' : 'text-[color:var(--surface-soft)]'}
        />
      ))}
    </div>
  );
}

function RatingsBody() {
  const max = Math.max(...DISTRIBUTION.map((d) => d.count), 1);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-2">
        <Star size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="text-2xl font-bold">Rating pelanggan</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            <span className="tabular-nums">{TOTAL}</span> ulasan · 30 hari
          </p>
        </div>
      </div>

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex flex-col items-center gap-1 sm:w-40">
          <p className="text-5xl font-extrabold tabular-nums">{AVERAGE.toLocaleString('id-ID')}</p>
          <Stars value={Math.round(AVERAGE)} size={18} />
          <p className="text-xs text-[color:var(--text-muted)]">dari 5,0</p>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          {DISTRIBUTION.map((d) => (
            <div key={d.stars} className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-right text-xs font-medium text-[color:var(--text-muted)]">
                {d.stars}★
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
                <div
                  className={d.stars === '1-2' ? 'h-full rounded-full' : 'h-full rounded-full bg-amber-500'}
                  style={{
                    width: `${(d.count / max) * 100}%`,
                    ...(d.stars === '1-2' ? { background: 'var(--danger)' } : {}),
                  }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-[color:var(--text-muted)]">
                {d.count}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        {REVIEWS.map((r) => (
          <Card key={r.id} className="flex gap-3 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
              {r.name.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{r.name}</p>
                <span className="text-xs text-[color:var(--text-muted)]">{r.when}</span>
              </div>
              <Stars value={r.stars} />
              <p className="mt-1.5 text-sm text-[color:var(--text)]">“{r.quote}”</p>
              {r.stars <= 3 && (
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-brand-600 hover:underline"
                >
                  Balas →
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotManager(customer?.role)) {
    return (
      <CenterState title="Khusus Manajer depot" icon={<Lock size={40} weight="fill" />}>
        Rating & ulasan pelanggan hanya untuk Manajer depot.
      </CenterState>
    );
  }
  return <RatingsBody />;
}

export default function RatingsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
