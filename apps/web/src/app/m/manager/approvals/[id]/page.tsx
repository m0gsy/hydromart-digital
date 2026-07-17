'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ImageSquare } from '@phosphor-icons/react';

import { APPROVALS, KIND_LABEL } from '@/components/manager-mobile/approval-placeholder';
import { Badge, Card, CenterState, Money } from '@/components/ui';

// TODO: wire to approval-queue endpoint when backend lands (see approval-placeholder.ts).

export default function ApprovalDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const a = APPROVALS.find((x) => x.id === id);

  if (!a) {
    return (
      <div className="px-4 py-6">
        <CenterState title="Approval tidak ditemukan">
          <Link href="/m/manager/approvals" className="font-bold text-brand-700">
            Kembali ke daftar
          </Link>
        </CenterState>
      </div>
    );
  }

  const variance = a.physicalValue - a.systemvalue;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-9 items-center justify-center rounded-xl border border-app"
          aria-label="Kembali"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold">{a.title}</div>
          <div className="truncate text-[11px] text-[color:var(--text-muted)]">{a.subtitle}</div>
        </div>
        <Badge tone="warning">{KIND_LABEL[a.kind]}</Badge>
      </header>

      <div className="flex-1 space-y-3 px-4 pb-6">
        <Card className="grid grid-cols-3 divide-x divide-[color:var(--border)] p-0">
          <TriStat label="Sistem" value={a.systemvalue.toLocaleString('id-ID')} />
          <TriStat label="Fisik" value={a.physicalValue.toLocaleString('id-ID')} />
          <TriStat
            label="Selisih"
            value={`${variance > 0 ? '+' : ''}${variance.toLocaleString('id-ID')}`}
            tone={variance === 0 ? undefined : 'danger'}
          />
        </Card>

        <Card className="px-4 py-1">
          <RowLine label="Nilai kerugian">
            <span className="font-extrabold tabular-nums text-red-600">
              <Money amount={a.amount} />
            </span>
          </RowLine>
          <RowLine label="Batas auto-pass" divider>
            <span className="font-semibold tabular-nums text-[color:var(--text-muted)]">
              <Money amount={a.autoPassThreshold} />
            </span>
          </RowLine>
          <RowLine label="Diajukan oleh" divider>
            <span className="text-sm font-semibold">{a.requestedBy}</span>
          </RowLine>
        </Card>

        <Card className="space-y-3 p-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
              Catatan operator
            </div>
            <p className="mt-1 text-sm">{a.note}</p>
          </div>
          <div className="flex gap-2">
            {a.photos > 0 ? (
              Array.from({ length: a.photos }).map((_, i) => (
                <div
                  key={i}
                  className="flex size-16 items-center justify-center rounded-xl bg-[color:var(--surface-muted)] text-[color:var(--text-muted)]"
                >
                  <ImageSquare size={22} />
                </div>
              ))
            ) : (
              <p className="text-xs text-[color:var(--text-muted)]">Tidak ada foto.</p>
            )}
          </div>
        </Card>
      </div>

      <footer className="sticky bottom-0 flex gap-3 border-t border-app bg-[color:var(--surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => router.push('/m/manager/approvals')}
          className="flex-1 rounded-xl border border-red-200 py-3 text-sm font-extrabold text-red-600"
        >
          Tolak
        </button>
        <button
          type="button"
          onClick={() => router.push('/m/manager/approvals')}
          className="flex-1 rounded-xl bg-brand-600 py-3 text-sm font-extrabold text-on-brand"
        >
          Setujui
        </button>
      </footer>
    </div>
  );
}

function TriStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div className="px-2 py-4 text-center">
      <div className={`text-xl font-extrabold tabular-nums ${tone === 'danger' ? 'text-red-600' : ''}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

function RowLine({
  label,
  divider,
  children,
}: {
  label: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between py-3 ${divider ? 'border-t border-[color:var(--border)]' : ''}`}
    >
      <span className="text-sm font-semibold">{label}</span>
      {children}
    </div>
  );
}
