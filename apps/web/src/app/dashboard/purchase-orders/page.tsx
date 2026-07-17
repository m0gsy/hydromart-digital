'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardText, Lock, Sparkle, Truck } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canManageProcurement } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { PoStatus, PurchaseOrder } from '@/lib/types';

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

function Body() {
  const { scopedId, selected, depots, ready } = useDepot();
  const [status, setStatus] = useState<PoStatus | ''>('');

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
        <Link href="/dashboard/forecast">
          <Button variant="secondary">
            <Sparkle size={16} weight="fill" className="mr-1.5" />
            Buat dari forecast
          </Button>
        </Link>
      </div>

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
