'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Lock } from '@phosphor-icons/react';

import { RequireAuth } from '@/components/require-auth';
import { Badge, Button, Card, CenterState, ErrorState, Field, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { canReviewApprovals } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import type { Approval, ApprovalStatus, ApprovalType } from '@/lib/types';

const TYPE_LABEL: Record<ApprovalType, string> = {
  OPNAME_VARIANCE: 'Selisih opname',
  DEPOSIT_REFUND: 'Refund deposit',
  COD_VARIANCE: 'Kurang setoran',
};

const STATUS_TONE: Record<ApprovalStatus, 'brand' | 'success' | 'danger' | 'warning'> = {
  PENDING: 'brand',
  APPROVED: 'success',
  REJECTED: 'danger',
  HELD: 'warning',
};

const num = (v: unknown) => Number(v ?? 0);

function TriStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="px-2 py-4 text-center">
      <div className={`text-xl font-extrabold tabular-nums ${tone === 'danger' ? 'text-[color:var(--danger)]' : ''}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

/** Type-specific snapshot: opname tri-stat, deposit/COD figure rows. */
function Snapshot({ a }: { a: Approval }) {
  const p = a.payload ?? {};
  if (a.type === 'OPNAME_VARIANCE') {
    const variance = num(p.variance);
    return (
      <Card className="grid grid-cols-3 divide-x divide-[color:var(--border)] p-0">
        <TriStat label="Sistem" value={num(p.system).toLocaleString('id-ID')} />
        <TriStat label="Fisik" value={num(p.physical).toLocaleString('id-ID')} />
        <TriStat
          label="Selisih"
          value={`${variance > 0 ? '+' : ''}${variance.toLocaleString('id-ID')}`}
          tone={variance === 0 ? undefined : 'danger'}
        />
      </Card>
    );
  }
  if (a.type === 'DEPOSIT_REFUND') {
    return (
      <Card className="px-4 py-1">
        <RowLine label="Kondisi galon">
          <span className="text-sm font-semibold">{String(p.condition ?? '—')}</span>
        </RowLine>
        <RowLine label="Deposit dikembalikan" divider>
          <Money amount={num(p.deposit)} className="font-extrabold tabular-nums" />
        </RowLine>
      </Card>
    );
  }
  return (
    <Card className="px-4 py-1">
      <RowLine label="Diharapkan (sistem)">
        <Money amount={num(p.expected)} className="font-semibold tabular-nums" />
      </RowLine>
      <RowLine label="Diterima (setoran)" divider>
        <Money amount={num(p.received)} className="font-semibold tabular-nums" />
      </RowLine>
    </Card>
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

function Detail({ id }: { id: string }) {
  const router = useRouter();
  const detail = useAsync<Approval>(() => api.get(endpoints.approvals.detail(id), true), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | 'HOLD' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'APPROVE' | 'REJECT' | 'HOLD') => {
    if (decision === 'REJECT' && note.trim() === '') {
      setError('Isi alasan penolakan.');
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      await api.patch(endpoints.approvals.decide(id), { decision, note: note.trim() || undefined }, true);
      router.push('/dashboard/approvals');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aksi gagal. Coba lagi.');
      setBusy(null);
    }
  };

  if (detail.loading) return <Skeleton className="h-72 w-full" />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) {
    return (
      <CenterState title="Approval tidak ditemukan">
        <Link href="/dashboard/approvals" className="font-bold text-brand-700">
          Kembali ke antrean
        </Link>
      </CenterState>
    );
  }

  const a = detail.data;
  const pending = a.status === 'PENDING' || a.status === 'HELD';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Link
          href="/dashboard/approvals"
          className="flex size-9 items-center justify-center rounded-xl border border-app"
          aria-label="Kembali"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{a.title}</h1>
          <p className="truncate text-xs text-[color:var(--text-muted)]">
            {formatDateTime(a.createdAt)}
            {a.subjectRef ? ` · ${a.subjectRef}` : ''}
          </p>
        </div>
        <Badge tone={STATUS_TONE[a.status]}>{TYPE_LABEL[a.type]}</Badge>
      </header>

      <Snapshot a={a} />

      <Card className="px-4 py-1">
        <RowLine label="Nilai (kerugian/refund/kurang)">
          <Money amount={Math.abs(a.amountIdr)} className="font-extrabold tabular-nums text-[color:var(--danger)]" />
        </RowLine>
        <RowLine label="Batas auto-pass" divider>
          <Money amount={a.autoPassThreshold} className="font-semibold tabular-nums text-[color:var(--text-muted)]" />
        </RowLine>
      </Card>

      {a.decisionNote && (
        <Card className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
            Catatan operator / keputusan
          </div>
          <p className="mt-1 text-sm">{a.decisionNote}</p>
        </Card>
      )}

      {pending ? (
        <Card className="flex flex-col gap-3 p-4">
          <Field label="Catatan (wajib untuk tolak)" htmlFor="decide-note">
            <Input id="decide-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. selisih wajar, sudah dicek" />
          </Field>
          {error && <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => decide('REJECT')} loading={busy === 'REJECT'} className="flex-1">
              Tolak
            </Button>
            <Button variant="ghost" onClick={() => decide('HOLD')} loading={busy === 'HOLD'} className="flex-1">
              Tahan
            </Button>
            <Button onClick={() => decide('APPROVE')} loading={busy === 'APPROVE'} className="flex-1">
              Setujui
            </Button>
          </div>
        </Card>
      ) : (
        <p className="text-sm text-[color:var(--text-muted)]">
          Item ini sudah {a.status === 'APPROVED' ? 'disetujui' : 'ditolak'}.
        </p>
      )}
    </div>
  );
}

function Gate({ id }: { id: string }) {
  const { customer } = useAuth();
  if (!canReviewApprovals(customer?.role)) {
    return (
      <CenterState title="Khusus manajer depot" icon={<Lock size={40} weight="fill" />}>
        Antrean approval tersedia untuk manajer depot dan super admin.
      </CenterState>
    );
  }
  return <Detail id={id} />;
}

export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireAuth>
      <Gate id={id} />
    </RequireAuth>
  );
}
