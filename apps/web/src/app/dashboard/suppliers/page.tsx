'use client';

import { useState } from 'react';
import { Lock, Phone, Plus, Storefront } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import {
  Badge,
  Button,
  Card,
  CenterState,
  ErrorState,
  Field,
  Input,
  LoadError,
  Money,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canManageProcurement } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useT } from '@/lib/locale-context';
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
  const { t } = useT();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [categories, setCategories] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (name.trim().length < 2 || code.trim().length < 2) {
      setError(t('opsFix.suppliers.nameRequired'));
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
      setError(e instanceof ApiError ? e.message : t('opsFix.suppliers.addError'));
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <Field label={t('opsFix.suppliers.name')} htmlFor="sup-name">
        <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('opsFix.suppliers.namePlaceholder')} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('opsFix.suppliers.code')} htmlFor="sup-code">
          <Input id="sup-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('opsFix.suppliers.codePlaceholder')} />
        </Field>
        <Field label={t('opsFix.suppliers.phone')} htmlFor="sup-phone">
          <Input id="sup-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('opsFix.suppliers.phonePlaceholder')} />
        </Field>
      </div>
      <Field label={t('opsFix.suppliers.categories')} htmlFor="sup-cat">
        <Input id="sup-cat" value={categories} onChange={(e) => setCategories(e.target.value)} placeholder={t('opsFix.suppliers.categoriesPlaceholder')} />
      </Field>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          {t('opsFix.suppliers.cancel')}
        </Button>
        <Button onClick={submit} loading={busy}>
          {t('opsFix.suppliers.save')}
        </Button>
      </div>
    </Card>
  );
}

function SupplierCard({ supplier, stats }: { supplier: Supplier; stats: PoStats }) {
  const { t } = useT();
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
          <dt className="text-xs text-muted">{t('opsFix.suppliers.poCount')}</dt>
          <dd className="font-semibold tabular-nums">{stats.count}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('opsFix.suppliers.poValue')}</dt>
          <dd className="font-semibold tabular-nums">
            <Money amount={stats.value} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t('opsFix.suppliers.lastPo')}</dt>
          <dd className="text-xs font-semibold">{stats.lastPo ? formatDateTime(stats.lastPo) : '—'}</dd>
        </div>
      </dl>
    </Card>
  );
}

function Body() {
  const { t } = useT();
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
          <h1 className="text-2xl font-bold">{t('opsFix.suppliers.title')}</h1>
        </div>
        {scopedId && !adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} weight="bold" className="mr-1.5" />
            {t('opsFix.suppliers.add')}
          </Button>
        )}
      </div>

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          {t('opsFix.suppliers.scopeNote', {
            depot: `${scopedDepot.name} · ${scopedDepot.code}`,
          })}
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
        <CenterState title={t('opsFix.suppliers.noDepots')} icon={<Storefront size={40} weight="fill" />}>
          {t('opsFix.suppliers.noDepotsBody')}
        </CenterState>
      ) : suppliers.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : suppliers.error ? (
        <ErrorState message={suppliers.error} onRetry={suppliers.reload} />
      ) : !suppliers.data || suppliers.data.length === 0 ? (
        <CenterState title={t('opsFix.suppliers.empty')} icon={<Storefront size={40} weight="fill" />}>
          {t('opsFix.suppliers.emptyBody')}
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Every card's PO count, value and last-order date come from ONE read, and each
              falls back to 0/—. A supplier the depot buys from weekly then reads as dormant. */}
          {orders.error && (
            <LoadError onRetry={orders.reload} className="sm:col-span-2" />
          )}
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
  const { t } = useT();
  const { customer } = useAuth();
  if (!canManageProcurement(customer?.role)) {
    return (
      <CenterState title={t('opsFix.suppliers.gate')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.suppliers.gateBody')}
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
