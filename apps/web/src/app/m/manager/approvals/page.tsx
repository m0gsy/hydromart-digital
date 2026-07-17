'use client';

import Link from 'next/link';
import { CaretRight, Gavel } from '@phosphor-icons/react';

import { APPROVALS, KIND_LABEL, type ManagerApproval } from '@/components/manager-mobile/approval-placeholder';
import { Badge, Card, CenterState, Money } from '@/components/ui';

// TODO: wire to approval-queue endpoint when backend lands (see approval-placeholder.ts).

function Row({ a }: { a: ManagerApproval }) {
  return (
    <Link href={`/m/manager/approvals/${a.id}`}>
      <Card className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Gavel size={18} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-extrabold">{a.title}</p>
            <Badge tone="warning">{KIND_LABEL[a.kind]}</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">{a.subtitle}</p>
          <p className="mt-1.5 text-sm font-extrabold text-brand-700">
            <Money amount={a.amount} />
          </p>
        </div>
        <CaretRight size={15} className="mt-1 shrink-0 text-[color:var(--text-muted)]" />
      </Card>
    </Link>
  );
}

export default function ApprovalsPage() {
  return (
    <div className="space-y-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight">Approval</h1>
        <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">
          Permintaan yang butuh persetujuan manajer.
        </p>
      </header>

      {APPROVALS.length === 0 ? (
        <CenterState icon={<Gavel size={32} />} title="Tidak ada approval">
          Semua permintaan sudah diproses.
        </CenterState>
      ) : (
        <div className="space-y-2.5">
          {APPROVALS.map((a) => (
            <Row key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}
