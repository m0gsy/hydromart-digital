'use client';

import { useState } from 'react';
import {
  CaretRight,
  DeviceMobile,
  Gear,
  Key,
  Lock,
  Package,
  ShoppingBag,
  SignOut,
  Truck,
  UserCircle,
  type Icon,
} from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, Chip, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/locale-context';
import { isDepotOperator } from '@/lib/roles';

const OPS_NOTIF: { id: string; icon: Icon; label: string; def: boolean }[] = [
  { id: 'lowStock', icon: Package, label: 'Stok menipis', def: true },
  { id: 'newOrder', icon: ShoppingBag, label: 'Pesanan baru masuk', def: true },
  { id: 'courierFail', icon: Truck, label: 'Kurir gagal antar', def: true },
];

function OperatorSettingsBody() {
  const { signOut } = useAuth();
  const { locale, setLocale } = useT();
  const [notif, setNotif] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(OPS_NOTIF.map((n) => [n.id, n.def])),
  );

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <div className="flex items-center gap-2">
        <Gear size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">Pengaturan</h1>
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
          Akun
        </p>
        <Card className="divide-y divide-app p-0">
          <StaticRow icon={UserCircle} label="Data akun" sub="Nama, telepon & depot" />
          <StaticRow icon={Key} label="Ubah PIN" sub="Ganti PIN operasional" />
        </Card>
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
          Notifikasi ops
        </p>
        <Card className="divide-y divide-app p-0">
          {OPS_NOTIF.map((n) => {
            const NIcon = n.icon;
            return (
              <div key={n.id} className="flex items-center gap-3 p-4">
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <NIcon size={18} weight="fill" />
                </span>
                <span className="flex-1 text-sm font-semibold">{n.label}</span>
                <Toggle
                  on={notif[n.id] ?? n.def}
                  onChange={(v) => setNotif((prev) => ({ ...prev, [n.id]: v }))}
                  label={n.label}
                />
              </div>
            );
          })}
        </Card>
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
          Preferensi
        </p>
        <Card className="divide-y divide-app p-0">
          <div className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Package size={18} weight="fill" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold">Ambang low-stock default</p>
              <p className="text-[11px] text-[color:var(--text-muted)]">Batas bawah stok per item</p>
            </div>
            <Chip tone="tint">20 unit</Chip>
          </div>
          <div className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <DeviceMobile size={18} weight="fill" />
            </span>
            <span className="flex-1 text-sm font-semibold">Bahasa</span>
            <div className="flex overflow-hidden rounded-full border border-app text-xs font-bold">
              {(['id', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  className={`px-3 py-1.5 uppercase ${
                    locale === l ? 'bg-brand-600 text-on-brand' : 'text-[color:var(--text-muted)]'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <button
        type="button"
        onClick={signOut}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 p-3.5 text-sm font-extrabold text-red-600"
      >
        <SignOut size={17} />
        Keluar
      </button>
    </div>
  );
}

function StaticRow({ icon: RIcon, label, sub }: { icon: Icon; label: string; sub: string }) {
  return (
    <button type="button" className="flex w-full items-center gap-3 p-4 text-left">
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <RIcon size={18} weight="fill" />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[11px] text-[color:var(--text-muted)]">{sub}</p>
      </div>
      <CaretRight size={15} className="text-[color:var(--text-muted)]" />
    </button>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!isDepotOperator(customer?.role)) {
    return (
      <CenterState title="Khusus Operator depot" icon={<Lock size={40} weight="fill" />}>
        Pengaturan ini hanya untuk Operator depot.
      </CenterState>
    );
  }
  return <OperatorSettingsBody />;
}

export default function OperatorSettingsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
