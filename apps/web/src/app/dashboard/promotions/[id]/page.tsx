'use client';

import { useParams } from 'next/navigation';
import { Lock, Megaphone, CheckCircle, Users } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { isStaff } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Promotion } from '@/lib/types';

// Analytics are local + TODO keyed by the route id — no promo-analytics backend yet.
// TODO: wire to promotions/vouchers analytics backend.
const USAGE_7D = [4, 9, 6, 12, 8, 15, 11];
const DAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

const TERMS = [
  { label: 'Minimum belanja Rp50.000', met: true },
  { label: 'Maksimum 1× per pelanggan', met: true },
  { label: 'Hanya produk Galon 19L', met: false },
];

const TOP_USERS = [
  { name: 'Budi Santoso', uses: 6 },
  { name: 'Toko Jaya', uses: 5 },
  { name: 'Siti Aminah', uses: 3 },
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}

function UsageChart() {
  const max = Math.max(...USAGE_7D);
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="font-semibold">Pemakaian 7 hari</h2>
      <div className="flex items-end justify-between gap-2" style={{ height: 140 }}>
        {USAGE_7D.map((v, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="text-xs font-semibold tabular-nums text-muted">{v}</span>
            <div
              className="w-full rounded-t-md bg-brand-500"
              style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
            />
            <span className="text-xs text-muted">{DAY_LABELS[i]}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PromoDetailBody({ id }: { id: string }) {
  // REAL — find this promo in the admin list for its code / active state (header).
  const promos = useAsync<Promotion[]>(() => api.get<Promotion[]>(endpoints.promotions.manage, true), []);
  const promo = (promos.data ?? []).find((p) => p.id === id) ?? null;
  const code = promo?.voucherCode ?? promo?.title ?? id.slice(0, 8).toUpperCase();
  const active = promo?.active ?? true;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone size={24} weight="fill" className="text-brand-500" />
          <div>
            {promos.loading ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                {code}
                <Badge tone={active ? 'success' : 'neutral'}>{active ? 'AKTIF' : 'NONAKTIF'}</Badge>
              </h1>
            )}
            <p className="text-sm text-muted">Detail promo &amp; analitik</p>
          </div>
        </div>
        {/* TODO: wire to promo editor (endpoints.promotions.detail PATCH). */}
        <Button variant="secondary">Ubah</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Dipakai" value="65×" />
        <Stat label="Penghematan diberikan" value="Rp 1.300.000" />
        <Stat label="Order terpengaruh" value="58" />
        <Stat label="Nilai order" value="Rp 4.720.000" />
      </div>

      <UsageChart />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-semibold">Syarat</h2>
          <ul className="flex flex-col gap-2.5">
            {TERMS.map((tm) => (
              <li key={tm.label} className="flex items-center gap-2 text-sm">
                <CheckCircle
                  size={18}
                  weight="fill"
                  className={tm.met ? 'text-[color:var(--success)]' : 'text-muted'}
                />
                <span className={tm.met ? '' : 'text-muted'}>{tm.label}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users size={18} weight="fill" className="text-brand-600" /> Pengguna teratas
          </h2>
          <ul className="flex flex-col">
            {TOP_USERS.map((u) => (
              <li
                key={u.name}
                className="flex items-center justify-between gap-3 border-b border-app py-2.5 text-sm last:border-0"
              >
                <span className="font-medium">{u.name}</span>
                <span className="tabular-nums text-muted">{u.uses}× pakai</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="text-xs text-muted">
        {/* Analytics figures are placeholders until the promo-analytics backend lands. */}
        Analitik pemakaian masih contoh — menunggu backend analitik promo.
      </p>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  if (!isStaff(customer?.role)) {
    return (
      <CenterState title="Khusus staf" icon={<Lock size={40} weight="fill" />}>
        Analitik promo hanya untuk staf depot.
      </CenterState>
    );
  }
  return <PromoDetailBody id={id} />;
}

export default function PromoDetailPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
