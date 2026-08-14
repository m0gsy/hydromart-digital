'use client';

import Link from 'next/link';
import { useT } from '@/lib/locale-context';
import { CaretRight, Gavel } from '@phosphor-icons/react';

import { Badge, Card, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useDepot } from '@/lib/depot-context';
import { useAsync } from '@/lib/use-async';
import type { Approval, ApprovalType } from '@/lib/types';

// Keys, not copy. Four approval types and four summary lines — every word a manager reads
// while deciding money — sat in an enum-keyed map and a set of template literals, the two
// shapes the i18n scanner was blind to.
const KIND_LABEL: Record<ApprovalType, string> = {
  OPNAME_VARIANCE: 'mgrFix.approvalKind.OPNAME_VARIANCE',
  DEPOSIT_REFUND: 'mgrFix.approvalKind.DEPOSIT_REFUND',
  COD_VARIANCE: 'mgrFix.approvalKind.COD_VARIANCE',
  GALLON_VARIANCE: 'mgrFix.approvalKind.GALLON_VARIANCE',
};

const idr = (v: unknown) => Number(v ?? 0).toLocaleString('id-ID');

function subtitle(a: Approval, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const p = a.payload ?? {};
  if (a.type === 'OPNAME_VARIANCE')
    return t('mgrFix.approvalSummary.OPNAME_VARIANCE', { system: idr(p.system), physical: idr(p.physical) });
  if (a.type === 'DEPOSIT_REFUND')
    return t('mgrFix.approvalSummary.DEPOSIT_REFUND', {
      condition: String(p.condition ?? '—'),
      deposit: idr(p.deposit ?? p.depositRefunded),
    });
  if (a.type === 'GALLON_VARIANCE')
    return t('mgrFix.approvalSummary.GALLON_VARIANCE', { gallons: idr(p.excessGallons) });
  return t('mgrFix.approvalSummary.COD_VARIANCE', { expected: idr(p.expected), received: idr(p.received) });
}

function Row({ a }: { a: Approval }) {
  const { t } = useT();
  return (
    <Link href={`/m/manager/approvals/detail?id=${a.id}`}>
      <Card className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Gavel size={18} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-extrabold">{a.title}</p>
            <Badge tone="warning">{t(KIND_LABEL[a.type])}</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">{subtitle(a, t)}</p>
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
  const { t } = useT();
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
        <h1 className="text-xl font-extrabold tracking-tight">{t('hrFix.managerApprovals.title')}</h1>
        <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">
          {t('hrFix.managerApprovals.subtitle2')}
        </p>
      </header>

      {list.loading ? (
        <Skeleton className="h-40 w-full" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.length === 0 ? (
        <CenterState icon={<Gavel size={32} />} title={t('hrFix.managerApprovals.empty')}>
          {t('hrFix.managerApprovals.allDone')}
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
