'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardText, Lock, Sparkle, Truck, Warning } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT } from '@/lib/locale-context';
import { canManageProcurement } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { InventoryItem, PoStatus, PurchaseOrder, Supplier } from '@/lib/types';

const STATUS_LABEL: Record<PoStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Dikirim',
  RECEIVED: 'Diterima',
};

const STATUS_TONE: Record<PoStatus, 'warning' | 'brand' | 'success'> = {
  DRAFT: 'warning',
  SENT: 'brand',
  RECEIVED: 'success',
};

function PoCard({ po, onChanged }: { po: PurchaseOrder; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: 'send' | 'receive') {
    setBusy(true);
    setError(null);
    try {
      const url =
        kind === 'send'
          ? endpoints.procurement.purchaseOrders.send(po.id)
          : endpoints.procurement.purchaseOrders.receive(po.id);
      await api.post(url, {}, true);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aksi gagal. Coba lagi.');
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/dashboard/purchase-orders/${po.id}`} className="min-w-0">
          <p className="truncate font-semibold hover:underline">{po.poNumber}</p>
          <p className="truncate text-xs text-muted">{po.supplierName}</p>
        </Link>
        <Badge tone={STATUS_TONE[po.status]}>{STATUS_LABEL[po.status]}</Badge>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Nilai</p>
          <Money amount={po.totalIdr} className="text-lg font-extrabold tabular-nums" />
        </div>
        <p className="text-xs text-muted">{formatDateTime(po.createdAt)}</p>
      </div>
      {error && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {error}
        </p>
      )}
      {po.status === 'DRAFT' && (
        <Button onClick={() => act('send')} loading={busy} className="w-full">
          Kirim ke pemasok
        </Button>
      )}
      {po.status === 'SENT' && (
        <Button onClick={() => act('receive')} loading={busy} className="w-full">
          Terima → RECEIPT
        </Button>
      )}
    </Card>
  );
}

type DraftLine = { picked: boolean; qty: string; cost: string };

/** 12c — pick low-stock lines, choose a supplier, POST a DRAFT purchase order. Every
 *  endpoint is real (inventory low-stock lines + suppliers + create PO). */
function LowStockDraft({ depotId, onCreated, onClose }: { depotId: string; onCreated: () => void; onClose: () => void }) {
  const { t } = useT();
  const low = useAsync<InventoryItem[]>(
    () => api.get(endpoints.inventory.lines(depotId, { lowStockOnly: true }), true),
    [depotId],
  );
  const suppliers = useAsync<Supplier[]>(() => api.get(endpoints.procurement.suppliers.list(depotId), true), [depotId]);

  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<Record<string, DraftLine>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = low.data ?? [];
  const lineOf = (i: InventoryItem): DraftLine =>
    lines[i.id] ?? { picked: false, qty: String(Math.max(1, i.minimumStock - i.available)), cost: '' };
  const patch = (id: string, p: Partial<DraftLine>) =>
    setLines((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { picked: false, qty: '', cost: '' }), ...p } }));

  const picked = items.filter((i) => lineOf(i).picked);

  async function create() {
    if (!supplierId) {
      setError(t('opsFix.poDraft.needSupplier'));
      return;
    }
    if (picked.length === 0) {
      setError(t('opsFix.poDraft.pickAtLeastOne'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        endpoints.procurement.purchaseOrders.create,
        {
          depotId,
          supplierId,
          lines: picked.map((i) => {
            const l = lineOf(i);
            return {
              itemType: i.itemType,
              label: i.label,
              quantity: Math.max(1, Number(l.qty) || 1),
              unitCostIdr: Math.max(0, Math.round(Number(l.cost) || 0)),
            };
          }),
        },
        true,
      );
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('opsFix.poDraft.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('opsFix.poDraft.title')}</h2>
          <p className="text-sm text-muted">{t('opsFix.poDraft.subtitle')}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          {t('opsFix.poDraft.close')}
        </Button>
      </div>

      {low.loading || suppliers.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : low.error ? (
        <ErrorState message={low.error} onRetry={low.reload} />
      ) : suppliers.data && suppliers.data.length === 0 ? (
        <p className="rounded-lg bg-[color:var(--surface-soft)] px-3 py-2 text-sm text-muted">{t('opsFix.poDraft.noSuppliers')}</p>
      ) : items.length === 0 ? (
        <CenterState title={t('opsFix.poDraft.noLowStock')} icon={<Warning size={40} weight="fill" />} />
      ) : (
        <>
          <Field label={t('opsFix.poDraft.supplier')} htmlFor="po-supplier">
            <select
              id="po-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm focus:outline focus:outline-2 focus:outline-brand-600"
            >
              <option value="">{t('opsFix.poDraft.selectSupplier')}</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="overflow-x-auto">
            <div className="min-w-[520px]">
              <div className="grid grid-cols-[24px_minmax(120px,1.8fr)_90px_120px] gap-2 border-b border-app px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                <span />
                <span>{t('opsFix.poDraft.colItem')}</span>
                <span className="text-right">{t('opsFix.poDraft.colQty')}</span>
                <span className="text-right">{t('opsFix.poDraft.colCost')}</span>
              </div>
              <div className="divide-y divide-[color:var(--border)]">
                {items.map((i) => {
                  const l = lineOf(i);
                  return (
                    <div key={i.id} className="grid grid-cols-[24px_minmax(120px,1.8fr)_90px_120px] items-center gap-2 py-2">
                      <input
                        type="checkbox"
                        checked={l.picked}
                        onChange={(e) => patch(i.id, { picked: e.target.checked })}
                        aria-label={i.label}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{i.label}</p>
                        <p className="text-xs text-[color:var(--danger)] tabular-nums">
                          {i.available}/{i.minimumStock}
                        </p>
                      </div>
                      <Input
                        inputMode="numeric"
                        value={l.qty}
                        onChange={(e) => patch(i.id, { qty: e.target.value })}
                        className="text-right"
                      />
                      <Input
                        inputMode="numeric"
                        value={l.cost}
                        onChange={(e) => patch(i.id, { cost: e.target.value })}
                        placeholder="0"
                        className="text-right"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted">{t('opsFix.poDraft.selectedCount', { n: picked.length })}</span>
            <Button onClick={create} loading={busy} disabled={picked.length === 0 || !supplierId}>
              {t('opsFix.poDraft.create')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function Body() {
  const { scopedId, selected, depots, ready } = useDepot();
  const { t } = useT();
  const [status, setStatus] = useState<PoStatus | ''>('');
  const [draftOpen, setDraftOpen] = useState(false);

  const orders = useAsync<PurchaseOrder[]>(
    () =>
      scopedId
        ? api.get(
            endpoints.procurement.purchaseOrders.list({ depotId: scopedId, status: status || undefined }),
            true,
          )
        : Promise.resolve([]),
    [scopedId, status],
  );

  const scopedDepot = selected ?? depots.find((d) => d.id === scopedId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardText size={24} weight="fill" className="text-brand-500" />
          <h1 className="text-2xl font-bold">Pesanan pembelian</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {scopedId && (
            <Button variant="secondary" onClick={() => setDraftOpen((v) => !v)}>
              <Warning size={16} weight="fill" className="mr-1.5" />
              {t('opsFix.poDraft.open')}
            </Button>
          )}
          <Link href="/dashboard/forecast">
            <Button variant="secondary">
              <Sparkle size={16} weight="fill" className="mr-1.5" />
              Buat dari forecast
            </Button>
          </Link>
        </div>
      </div>

      {draftOpen && scopedId && (
        <LowStockDraft depotId={scopedId} onCreated={orders.reload} onClose={() => setDraftOpen(false)} />
      )}

      {scopedDepot && (
        <p className="text-[12.5px] text-muted">
          PO untuk{' '}
          <strong className="text-[color:var(--text)]">
            {scopedDepot.name} · {scopedDepot.code}
          </strong>{' '}
          (dari switcher).
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(['', 'DRAFT', 'SENT', 'RECEIVED'] as const).map((s) => (
          <button
            key={s || 'ALL'}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              status === s ? 'bg-brand-500 text-white' : 'border border-app text-muted'
            }`}
          >
            {s === '' ? 'Semua' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {ready && depots.length === 0 ? (
        <CenterState title="Belum ada depot" icon={<Truck size={40} weight="fill" />}>
          Belum ada depot yang dikonfigurasi.
        </CenterState>
      ) : orders.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : orders.error ? (
        <ErrorState message={orders.error} onRetry={orders.reload} />
      ) : !orders.data || orders.data.length === 0 ? (
        <CenterState title="Belum ada PO" icon={<ClipboardText size={40} weight="fill" />}>
          Belum ada pesanan pembelian untuk filter ini.
        </CenterState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {orders.data.map((po) => (
            <PoCard key={po.id} po={po} onChanged={orders.reload} />
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
        Pengadaan tersedia untuk manajer depot dan super admin.
      </CenterState>
    );
  }
  return <Body />;
}

export default function PurchaseOrdersPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
