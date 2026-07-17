'use client';

import { useState } from 'react';
import { Lock, Phone, Plus, Storefront } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canManageProcurement } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { PurchaseOrder, Supplier } from '@/lib/types';

interface PoStats {
  count: number;
  value: number;
  lastPo: string | null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Inline add-supplier form (design 11b "Tambah"). */
function AddSupplierForm({ depotId, onDone }: { depotId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [categories, setCategories] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (name.trim().length < 2 || code.trim().length < 2) {
      setError('Isi nama dan kode pemasok.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.procurement.suppliers.create,
        {
          depotId,
          name: name.trim(),
          code: code.trim(),
          contactPhone: phone.trim() || undefined,
          categories: categories
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean),
        },
        true,
      );
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gagal menambah pemasok.');
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field label="Nama pemasok" htmlFor="sup-name">
        <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Tirta Makmur" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kode" htmlFor="sup-code">
          <Input id="sup-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SUP-01" />
        </Field>
        <Field label="Telepon" htmlFor="sup-phone">
          <Input id="sup-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812…" />
        </Field>
      </div>
      <Field label="Kategori (pisahkan dengan koma)" htmlFor="sup-cat">
        <Input id="sup-cat" value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="Galon 19L, Segel, Air baku" />
      </Field>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Batal
        </Button>
        <Button onClick={submit} loading={busy}>
          Simpan pemasok
        </Button>
      </div>
    </Card>
  );
}

function SupplierCard({ supplier, stats }: { supplier: Supplier; stats: PoStats }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-bold text-brand-700">
          {initials(supplier.name) || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{supplier.name}</p>
          <p className="text-xs text-muted">{supplier.code}</p>
          {supplier.contactPhone && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <Phone size={12} weight="fill" />
              {supplier.contactPhone}
            </p>
          )}
        </div>
        {supplier.onTimeRate != null && (
          <Badge tone={supplier.onTimeRate >= 0.9 ? 'success' : 'warning'}>
            {Math.round(supplier.onTimeRate * 100)}% tepat
          </Badge>
        )}
      </div>

      {supplier.categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {supplier.categories.map((c) => (
            <span key={c} className="rounded-full border border-app px-2 py-0.5 text-[11px] font-medium text-muted">
              {c}
            </span>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 border-t border-app pt-2 text-center text-sm">
        <div>
          <dt className="text-xs text-muted">PO</dt>
          <dd className="font-semibold tabular-nums">{stats.count}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Nilai</dt>
          <dd className="font-semibold tabular-nums">
            <Money amount={stats.value} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">PO terakhir</dt>
          <dd className="text-xs font-semibold">{stats.lastPo ? formatDateTime(stats.lastPo) : '—'}</dd>
        </div>
      </dl>
    </Card>
  );
}

function Body() {
  const { scopedId, selected, depots, ready } = useDepot();
  const [adding, setAdding] = useState(false);

  const suppliers = useAsync<Supplier[]>(
    () => (scopedId ? api.get(endpoints.procurement.suppliers.list(scopedId), true) : Promise.resolve([])),
    [scopedId],
  );
  const orders = useAsync<PurchaseOrder[]>(
    () =>
      scopedId
        ? api.get(endpoints.procurement.purchaseOrders.list({ depotId: scopedId }), true)
        : Promise.resolve([]),
    [scopedId],
  );

  // Per-supplier PO rollup (count / total value / last PO), computed client-side.
  const statsBySupplier = new Map<string, PoStats>();
  for (const po of orders.data ?? []) {
    const s = statsBySupplier.get(po.supplierId) ?? { count: 0, value: 0, lastPo: null };
    s.count += 1;
    s.value += po.totalIdr;
    if (!s.lastPo || po.createdAt > s.lastPo) s.lastPo = po.createdAt;
    statsBySupplier.set(po.supplierId, s);
  }

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Storefront size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Pemasok</h1>
        </div>
        {scopedId && !adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} weight="bold" className="mr-1.5" />
            Tambah
          </Button>
        )}
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          Pemasok untuk{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>{' '}
          (dari switcher).
        </p>
      )}

      {adding && scopedId && (
        <AddSupplierForm
          depotId={scopedId}
          onDone={() => {
            setAdding(false);
            suppliers.reload();
          }}
        />
      )}

      {ready && depots.length === 0 ? (
        <CenterState title="Belum ada depot" icon={<Storefront size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : suppliers.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : suppliers.error ? (
        <ErrorState message={suppliers.error} onRetry={suppliers.reload} />
      ) : !suppliers.data || suppliers.data.length === 0 ? (
        <CenterState title="Belum ada pemasok" icon={<Storefront size={40} weight="fill" />}>
          Tambahkan pemasok pertama depot ini.
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {suppliers.data.map((s) => (
            <SupplierCard
              key={s.id}
              supplier={s}
              stats={statsBySupplier.get(s.id) ?? { count: 0, value: 0, lastPo: null }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canManageProcurement(customer?.role)) {
    return (
      <CenterState title="Khusus manajer depot" icon={<Lock size={40} weight="fill" />}>
        Direktori pemasok tersedia untuk manajer depot dan super admin.
      </CenterState>
    );
  }
  return <Body />;
}

export default function SuppliersPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
