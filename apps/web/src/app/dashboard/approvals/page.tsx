'use client';

import Link from 'next/link';
import { CaretRight, Coins, Gavel, HandCoins, Lock, Package, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { canReviewApprovals } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Approval, ApprovalType } from '@/lib/types';

const TYPE_ICON: Record<ApprovalType, typeof Package> = {
  OPNAME_VARIANCE: Package,
  DEPOSIT_REFUND: HandCoins,
  COD_VARIANCE: Wallet,
};

const TYPE_LABEL: Record<ApprovalType, string> = {
  OPNAME_VARIANCE: 'Selisih opname',
  DEPOSIT_REFUND: 'Refund deposit',
  COD_VARIANCE: 'Kurang setoran',
};

const idr = (v: unknown) => Number(v ?? 0).toLocaleString('id-ID');

/** One-line summary of the decision snapshot, per type. */
function metaLine(a: Approval): string {
  const p = a.payload ?? {};
  if (a.type === 'OPNAME_VARIANCE') {
    return `Sistem ${idr(p.system)} · fisik ${idr(p.physical)} · selisih ${idr(p.variance)}`;
  }
  if (a.type === 'DEPOSIT_REFUND') {
    return `Kondisi ${String(p.condition ?? '—')} · deposit ${idr(p.deposit)}`;
  }
  return `Diharapkan ${idr(p.expected)} · diterima ${idr(p.received)}`;
}

function Row({ a }: { a: Approval }) {
  const Icon = TYPE_ICON[a.type] ?? Coins;
  return (
    <Link href={`/dashboard/approvals/${a.id}`} className="block">
      <Card className="flex items-center gap-3 p-4 transition hover:border-brand-300">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Icon size={20} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{a.title}</p>
          <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">
            {metaLine(a)}
            {a.subjectRef ? ` · oleh ${a.subjectRef}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money amount={Math.abs(a.amountIdr)} className="text-sm font-extrabold text-[color:var(--danger)]" />
          <p className="text-[11px] text-[color:var(--text-muted)]">{TYPE_LABEL[a.type]}</p>
        </div>
        <CaretRight size={16} className="shrink-0 text-[color:var(--text-muted)]" />
      </Card>
    </Link>
  );
}

function Body() {
  const { scopedId, selected } = useDepot();
  const list = useAsync<Approval[]>(
    () =>
      scopedId
        ? api.get(endpoints.approvals.list({ depotId: scopedId, status: 'PENDING' }), true)
        : Promise.resolve([]),
    [scopedId],
  );

  const count = list.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Gavel size={24} weight="fill" className="text-brand-500" />
        <h1 className="text-2xl font-bold">Antrean approval</h1>
      </div>
      <div>
        <p className="text-sm font-semibold">Menunggu approval · {count} item</p>
        <p className="text-[12.5px] text-[color:var(--text-muted)]">
          {selected
            ? `Depot ${selected.name} · ${selected.code}`
            : 'Menampilkan depot pertama — pilih depot di switcher.'}
        </p>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : count === 0 ? (
        <CenterState title="Tidak ada approval" icon={<Gavel size={40} weight="fill" />}>
          Semua permintaan sudah diproses untuk depot ini.
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data!.map((a) => (
            <Row key={a.id} a={a} />
          ))}
        </div>
      )}

      <p className="text-xs text-[color:var(--text-muted)]">
        Aksi di bawah ambang otomatis lolos tanpa persetujuan manajer. Hanya item di atas ambang
        yang muncul di sini.
      </p>
    </div>
  );
}

function Gate() {
  const { customer } = useAuth();
  if (!canReviewApprovals(customer?.role)) {
    return (
      <CenterState title="Khusus manajer depot" icon={<Lock size={40} weight="fill" />}>
        Antrean approval tersedia untuk manajer depot dan super admin.
      </CenterState>
    );
  }
  return <Body />;
}

export default function ApprovalsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
