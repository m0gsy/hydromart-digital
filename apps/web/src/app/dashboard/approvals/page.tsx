'use client';

import Link from 'next/link';
import { CaretRight, Coins, Gavel, HandCoins, Lock, Package, Wallet } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { useT, type TVars } from '@/lib/locale-context';
import { canReviewApprovals } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Approval, ApprovalType } from '@/lib/types';

const TYPE_ICON: Record<ApprovalType, typeof Package> = {
  OPNAME_VARIANCE: Package,
  DEPOSIT_REFUND: HandCoins,
  COD_VARIANCE: Wallet,
};

const idr = (v: unknown) => Number(v ?? 0).toLocaleString('id-ID');

/** One-line summary of the decision snapshot, per type. */
function metaLine(a: Approval, t: (key: string, vars?: TVars) => string): string {
  const p = a.payload ?? {};
  if (a.type === 'OPNAME_VARIANCE') {
    return t('dashA.approvals.metaOpname', { system: idr(p.system), physical: idr(p.physical), variance: idr(p.variance) });
  }
  if (a.type === 'DEPOSIT_REFUND') {
    return t('dashA.approvals.metaDeposit', { condition: String(p.condition ?? '—'), deposit: idr(p.deposit) });
  }
  return t('dashA.approvals.metaCod', { expected: idr(p.expected), received: idr(p.received) });
}

function Row({ a }: { a: Approval }) {
  const { t } = useT();
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
            {metaLine(a, t)}
            {a.subjectRef ? t('dashA.approvals.by', { ref: a.subjectRef }) : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money amount={Math.abs(a.amountIdr)} className="text-sm font-extrabold text-[color:var(--danger)]" />
          <p className="text-[11px] text-[color:var(--text-muted)]">{t(`dashA.approvals.type.${a.type}`)}</p>
        </div>
        <CaretRight size={16} className="shrink-0 text-[color:var(--text-muted)]" />
      </Card>
    </Link>
  );
}

function Body() {
  const { t } = useT();
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
        <h1 className="text-2xl font-bold">{t('dashA.approvals.title')}</h1>
      </div>
      <div>
        <p className="text-sm font-semibold">{t('dashA.approvals.waiting', { n: count })}</p>
        <p className="text-[12.5px] text-[color:var(--text-muted)]">
          {selected
            ? t('dashA.approvals.depotScope', { name: selected.name, code: selected.code })
            : t('dashA.approvals.pickDepot')}
        </p>
      </div>

      {list.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : count === 0 ? (
        <CenterState title={t('dashA.approvals.emptyTitle')} icon={<Gavel size={40} weight="fill" />}>
          {t('dashA.approvals.emptyBody')}
        </CenterState>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.data!.map((a) => (
            <Row key={a.id} a={a} />
          ))}
        </div>
      )}

      <p className="text-xs text-[color:var(--text-muted)]">
        {t('dashA.approvals.footer')}
      </p>
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canReviewApprovals(customer?.role)) {
    return (
      <CenterState title={t('dashA.approvals.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('dashA.approvals.gateBody')}
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
