'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react';

import { Badge, CenterState, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Approval, ApprovalType } from '@/lib/types';

const KIND_LABEL: Record<ApprovalType, string> = {
  OPNAME_VARIANCE: 'Selisih opname',
  DEPOSIT_REFUND: 'Refund deposit galon',
  COD_VARIANCE: 'Kurang setoran (COD)',
};

const num = (v: unknown) => Number(v ?? 0);

export default function ApprovalDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const detail = useAsync<Approval>(() => api.get(endpoints.approvals.detail(id), true), [id]);
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'APPROVE' | 'REJECT') => {
    setBusy(decision);
    setError(null);
    try {
      await api.patch(endpoints.approvals.decide(id), { decision }, true);
      router.push('/m/manager/approvals');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aksi gagal. Coba lagi.');
      setBusy(null);
    }
  };

  if (detail.loading) {
    return (
      <div className="px-4 py-6">
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (detail.error) {
    return (
      <div className="px-4 py-6">
        <ErrorState message={detail.error} onRetry={detail.reload} />
      </div>
    );
  }
  if (!detail.data) {
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

  const a = detail.data;
  const p = a.payload ?? {};
  const pending = a.status === 'PENDING' || a.status === 'HELD';
  const isOpname = a.type === 'OPNAME_VARIANCE';
  const variance = num(p.variance);

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
          <div className="truncate text-[11px] text-[color:var(--text-muted)]">
            {a.subjectRef ?? KIND_LABEL[a.type]}
          </div>
        </div>
        <Badge tone="warning">{KIND_LABEL[a.type]}</Badge>
      </header>

      <div className="flex-1 space-y-3 px-4 pb-6">
        {isOpname ? (
          <div className="grid grid-cols-3 divide-x divide-[color:var(--border)] rounded-2xl border border-app bg-[color:var(--surface)]">
            <TriStat label="Sistem" value={num(p.system).toLocaleString('id-ID')} />
            <TriStat label="Fisik" value={num(p.physical).toLocaleString('id-ID')} />
            <TriStat
              label="Selisih"
              value={`${variance > 0 ? '+' : ''}${variance.toLocaleString('id-ID')}`}
              tone={variance === 0 ? undefined : 'danger'}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-app bg-[color:var(--surface)] px-4 py-1">
            {a.type === 'DEPOSIT_REFUND' ? (
              <>
                <RowLine label="Kondisi galon">
                  <span className="text-sm font-semibold">{String(p.condition ?? '—')}</span>
                </RowLine>
                <RowLine label="Deposit" divider>
                  <span className="font-extrabold tabular-nums">
                    <Money amount={num(p.deposit)} />
                  </span>
                </RowLine>
              </>
            ) : (
              <>
                <RowLine label="Diharapkan">
                  <span className="font-semibold tabular-nums">
                    <Money amount={num(p.expected)} />
                  </span>
                </RowLine>
                <RowLine label="Diterima" divider>
                  <span className="font-semibold tabular-nums">
                    <Money amount={num(p.received)} />
                  </span>
                </RowLine>
              </>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-app bg-[color:var(--surface)] px-4 py-1">
          <RowLine label="Nilai">
            <span className="font-extrabold tabular-nums text-[color:var(--danger)]">
              <Money amount={Math.abs(a.amountIdr)} />
            </span>
          </RowLine>
          <RowLine label="Batas auto-pass" divider>
            <span className="font-semibold tabular-nums text-[color:var(--text-muted)]">
              <Money amount={a.autoPassThreshold} />
            </span>
          </RowLine>
        </div>

        {a.decisionNote && (
          <div className="rounded-2xl border border-app bg-[color:var(--surface)] p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
              Catatan
            </div>
            <p className="mt-1 text-sm">{a.decisionNote}</p>
          </div>
        )}

        {error && (
          <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
            {error}
          </p>
        )}
      </div>

      {pending ? (
        <footer className="sticky bottom-0 flex gap-3 border-t border-app bg-[color:var(--surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => decide('REJECT')}
            disabled={busy !== null}
            className="flex-1 rounded-xl border border-red-200 py-3 text-sm font-extrabold text-red-600 disabled:opacity-60"
          >
            {busy === 'REJECT' ? 'Memproses…' : 'Tolak'}
          </button>
          <button
            type="button"
            onClick={() => decide('APPROVE')}
            disabled={busy !== null}
            className="flex-1 rounded-xl bg-brand-600 py-3 text-sm font-extrabold text-on-brand disabled:opacity-60"
          >
            {busy === 'APPROVE' ? 'Memproses…' : 'Setujui'}
          </button>
        </footer>
      ) : (
        <footer className="border-t border-app bg-[color:var(--surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-sm text-[color:var(--text-muted)]">
          Item ini sudah {a.status === 'APPROVED' ? 'disetujui' : 'ditolak'}.
        </footer>
      )}
    </div>
  );
}

function TriStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
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

function RowLine({ label, divider, children }: { label: string; divider?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center justify-between py-3 ${divider ? 'border-t border-[color:var(--border)]' : ''}`}>
      <span className="text-sm font-semibold">{label}</span>
      {children}
    </div>
  );
}
