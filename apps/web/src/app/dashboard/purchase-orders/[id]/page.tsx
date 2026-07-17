'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, Info, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { canManageProcurement } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { PoStatus, PurchaseOrder } from '@/lib/types';

const STEPS: { status: PoStatus; label: string }[] = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'SENT', label: 'Dikirim' },
  { status: 'RECEIVED', label: 'Diterima' },
];

const STATUS_TONE: Record<PoStatus, 'warning' | 'brand' | 'success'> = {
  DRAFT: 'warning',
  SENT: 'brand',
  RECEIVED: 'success',
};

/** Draft → Dikirim → Diterima progress. */
function Stepper({ status }: { status: PoStatus }) {
  const active = STEPS.findIndex((s) => s.status === status);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s.status} className="flex flex-1 items-center gap-2">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`flex size-8 items-center justify-center rounded-full text-xs font-bold ${
                i <= active ? 'bg-brand-500 text-white' : 'border border-app text-muted'
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-[11px] font-semibold ${i <= active ? '' : 'text-muted'}`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 flex-1 ${i < active ? 'bg-brand-500' : 'bg-[color:var(--border)]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const detail = useAsync<PurchaseOrder>(() => api.get(endpoints.procurement.purchaseOrders.detail(id), true), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: 'send' | 'receive') {
    setBusy(true);
    setError(null);
    try {
      const url =
        kind === 'send'
          ? endpoints.procurement.purchaseOrders.send(id)
          : endpoints.procurement.purchaseOrders.receive(id);
      await api.post(url, {}, true);
      detail.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aksi gagal. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading) return <Skeleton className="h-72 w-full" />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) {
    return (
      <CenterState title="PO tidak ditemukan">
        <Link href="/dashboard/purchase-orders" className="font-bold text-brand-700">
          Kembali ke daftar
        </Link>
      </CenterState>
    );
  }

  const po = detail.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link
          href="/dashboard/purchase-orders"
          className="flex size-9 items-center justify-center rounded-xl border border-app"
          aria-label="Kembali"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{po.poNumber}</h1>
          <p className="truncate text-xs text-muted">
            {po.supplierName} · {formatDateTime(po.createdAt)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[po.status]}>{STEPS.find((s) => s.status === po.status)?.label}</Badge>
      </header>

      <Card className="p-4">
        <Stepper status={po.status} />
      </Card>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-app text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-bold">Item</th>
              <th className="px-4 py-2 text-right font-bold">Qty × Harga</th>
              <th className="px-4 py-2 text-right font-bold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => (
              <tr key={i} className="border-b border-app last:border-0">
                <td className="px-4 py-2">
                  <p className="font-medium">{l.label}</p>
                  <p className="text-xs text-muted">{l.itemType}</p>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {l.quantity} × <Money amount={l.unitCostIdr} />
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">
                  <Money amount={l.quantity * l.unitCostIdr} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="px-4 py-1">
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-muted">Subtotal</span>
          <Money amount={po.subtotalIdr} className="font-semibold tabular-nums" />
        </div>
        <div className="flex items-center justify-between border-t border-app py-2">
          <span className="text-sm text-muted">Ongkos kirim</span>
          <Money amount={po.shippingIdr} className="font-semibold tabular-nums" />
        </div>
        <div className="flex items-center justify-between border-t border-app py-2">
          <span className="text-sm font-bold">Total</span>
          <Money amount={po.totalIdr} className="text-lg font-extrabold tabular-nums" />
        </div>
      </Card>

      <Card className="flex items-start gap-2 bg-brand-50 p-3">
        <Info size={18} weight="fill" className="mt-0.5 shrink-0 text-brand-600" />
        <p className="text-sm text-brand-700">
          Terima barang mencatat <strong>RECEIPT +qty</strong> ke inventory depot untuk setiap baris.
        </p>
      </Card>

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
          <CheckCircle size={18} weight="fill" className="mr-1.5" />
          Terima barang → RECEIPT
        </Button>
      )}
      {po.status === 'RECEIVED' && po.receivedAt && (
        <p className="text-center text-sm text-muted">Diterima pada {formatDateTime(po.receivedAt)}.</p>
      )}
    </div>
  );
}

function Gate({ id }: { id: string }) {
  const { customer } = useAuth();
  if (!canManageProcurement(customer?.role)) {
    return (
      <CenterState title="Khusus manajer depot" icon={<Lock size={40} weight="fill" />}>
        Pengadaan tersedia untuk manajer depot dan super admin.
      </CenterState>
    );
  }
  return <Detail id={id} />;
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireAuth>
      <Gate id={id} />
    </RequireAuth>
  );
}
