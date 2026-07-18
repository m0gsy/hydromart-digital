'use client';

import Link from 'next/link';
import { CaretRight, Gavel } from '@phosphor-icons/react';

import { Badge, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';
import { useAsync } from '@/lib/use-async';
import type { Approval, ApprovalType } from '@/lib/types';

const KIND_LABEL: Record<ApprovalType, string> = {
  OPNAME_VARIANCE: 'Selisih opname',
  DEPOSIT_REFUND: 'Refund deposit galon',
  COD_VARIANCE: 'Kurang setoran (COD)',
};

const idr = (v: unknown) => Number(v ?? 0).toLocaleString('id-ID');

function subtitle(a: Approval): string {
  const p = a.payload ?? {};
  if (a.type === 'OPNAME_VARIANCE') return `Sistem ${idr(p.system)} · fisik ${idr(p.physical)}`;
  if (a.type === 'DEPOSIT_REFUND') return `Kondisi ${String(p.condition ?? '—')} · deposit ${idr(p.deposit)}`;
  return `Diharapkan ${idr(p.expected)} · diterima ${idr(p.received)}`;
}

function Row({ a }: { a: Approval }) {
  return (
    <Link href={`/m/manager/approvals/${a.id}`}>
      <Card className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Gavel size={18} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-extrabold">{a.title}</p>
            <Badge tone="warning">{KIND_LABEL[a.type]}</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">{subtitle(a)}</p>
          <p className="mt-1.5 text-sm font-extrabold text-brand-700">
            <Money amount={Math.abs(a.amountIdr)} />
          </p>
        </div>
        <CaretRight size={15} className="mt-1 shrink-0 text-[color:var(--text-muted)]" />
      </Card>
    </Link>
  );
}

export default function ApprovalsPage() {
  const { scopedId } = useDepot();
  const list = useAsync<Approval[]>(
    () =>
      scopedId
        ? api.get(endpoints.approvals.list({ depotId: scopedId, status: 'PENDING' }), true)
        : Promise.resolve([]),
    [scopedId],
  );

  return (
    <div className="space-y-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">Approval</h1>
        <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">
          Permintaan yang butuh persetujuan manajer.
        </p>
      </header>

      {list.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.length === 0 ? (
        <CenterState icon={<Gavel size={32} />} title="Tidak ada approval">
          Semua permintaan sudah diproses.
        </CenterState>
      ) : (
        <div className="space-y-2.5">
          {list.data.map((a) => (
            <Row key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}
