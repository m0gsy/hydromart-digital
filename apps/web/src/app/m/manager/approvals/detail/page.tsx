'use client';

import { useState } from 'react';
import { useT } from '@/lib/locale-context';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react';

import { useConfirm } from '@/components/confirm';
import { Badge, CenterState, ErrorState, Input, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAsync } from '@/lib/use-async';
import type { Approval, ApprovalType, Customer } from '@/lib/types';
import { useQueryParam } from '@/lib/use-query-param';
import { formatDateTime } from '@/lib/format';

// Dictionary KEYS — module scope, so t() runs at the call site.
const KIND_LABEL: Record<ApprovalType, string> = {
  OPNAME_VARIANCE: 'hrFix.approvalDetailExtra.opnameVariance',
  DEPOSIT_REFUND: 'hrFix.approvalDetailExtra.depositRefund',
  COD_VARIANCE: 'hrFix.approvalDetailExtra.codShortfall',
  GALLON_VARIANCE: 'hrFix.approvalDetailExtra.returnVariance',
};

const num = (v: unknown) => Number(v ?? 0);

/** Same fallback the desktop approval screen uses when the directory cannot answer. */
const shortId = (id: string) => id.slice(0, 8);

export default function ApprovalDetailPage() {
  const { t } = useT();
  const { confirm } = useConfirm();
  const router = useRouter();
  const id = useQueryParam('id');
  const detail = useAsync<Approval>(() => api.get(endpoints.approvals.detail(id), true), [id]);
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | 'HOLD' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * CA-4-41 — `DecideApprovalDto` has always accepted a `note`, and the desktop screen has
   * always sent one and required it on a rejection. This screen sent `{ decision }` alone.
   *
   * So a manager deciding from a phone — which is where a depot manager actually is —
   * refused a courier's cash shortfall or a customer's deposit refund with no reason
   * attached to it. The person on the other end got "Ditolak" and nothing else, and
   * `decisionNote`, which this same screen renders once an item is decided, was always
   * empty for anything decided here.
   */
  const [note, setNote] = useState('');
  // CA-4-42: the one account this screen has to name. Cached, and never fatal — a decision
  // screen must render whether or not the staff directory answers.
  const submittedBy = detail.data?.submittedBy;
  const names = useAsync<Customer[]>(
    async () => {
      if (!submittedBy) return [];
      try {
        return await api.getCached<Customer[]>(endpoints.auth.customersByIds([submittedBy]), true);
      } catch {
        return [];
      }
    },
    [submittedBy],
  );

  /*
   * CA-4-42. The server has accepted three decisions since the first migration —
   * `ApprovalDecision = 'APPROVE' | 'REJECT' | 'HOLD'` — and the desktop screen offers all
   * three. This one offered two, so a manager holding the phone could only decide NOW or
   * refuse: "I need to ask somebody" was not on the screen, and HELD is precisely the state
   * for that. The list already treats HELD as still-pending, so the state was reachable and
   * unreachable at the same time.
   */
  const decide = async (decision: 'APPROVE' | 'REJECT' | 'HOLD') => {
    /*
     * CA-4-44 — "Tolak" and "Setujui" sit side by side, same width, in a sticky footer at
     * the bottom of a phone screen, and neither asked anything. What they decide is a cash
     * shortfall, a deposit refund or a stock variance: money either moves or somebody is
     * held responsible for it, and the screen navigates away immediately afterwards with
     * no way back to the item.
     */
    const approve = decision === 'APPROVE';
    // Same rule as the desktop screen: a REJECTION has to say why. An approval need not —
    // the amount and the rule that let it through are already on the record. A hold is not
    // a refusal and does not move money, so it is not held to the rejection's rule either.
    if (decision === 'REJECT' && note.trim() === '') {
      setError(t('mgrFix.approvalDecide.rejectReasonRequired'));
      return;
    }
    // CA-4-42: a hold parks the item and moves nothing, so it does not need the
    // are-you-sure the two money decisions do.
    const ok =
      decision === 'HOLD' ||
      (await confirm({
      title: approve ? t('mgrFix.approvalDecide.approveTitle') : t('mgrFix.approvalDecide.rejectTitle'),
      message: t(
        approve ? 'mgrFix.approvalDecide.approveConfirm' : 'mgrFix.approvalDecide.rejectConfirm',
        {
          kind: t(
            (detail.data && KIND_LABEL[detail.data.type]) ?? 'mgrFix.approvalDecide.thisItem',
          ),
        },
      ),
      tone: approve ? 'primary' : 'danger',
      }));
    if (!ok) return;
    setBusy(decision);
    setError(null);
    try {
      await api.patch(
        endpoints.approvals.decide(id),
        { decision, note: note.trim() || undefined },
        true,
      );
      router.push('/m/manager/approvals');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('hrFix.approvalDetailExtra.actionFailed'));
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
        <CenterState title={t('hrFix.approvalDetail.notFound')}>
          <Link href="/m/manager/approvals" className="font-bold text-brand-700">
            {t('hrFix.approvalDetail.backToList2')}
          </Link>
        </CenterState>
      </div>
    );
  }

  const a = detail.data;
  const who = (uid: string | null | undefined): string => {
    if (!uid) return '—';
    /*
     * `Array.isArray`, not `?? []`. This screen decides money, and its rule — stated on the
     * desktop twin — is that it renders whether or not the staff directory answers. A
     * `catch` covers a directory that THROWS; it does not cover one that resolves to
     * something that is not a list, and `.find` on that takes the whole screen down.
     *
     * (Deliberately unlike the cart's add-on lookup, where the same guard would have hidden
     * a real shape drift. Here the screen's own promise is that a bad answer costs a NAME,
     * never the decision.)
     */
    const rows = Array.isArray(names.data) ? names.data : [];
    const found = rows.find((c) => c.id === uid);
    // An unresolved id is still an answer; an empty row is not (same rule as the desktop).
    return found ? found.fullName || found.phone : shortId(uid);
  };
  const p = a.payload ?? {};
  const pending = a.status === 'PENDING' || a.status === 'HELD';
  const isOpname = a.type === 'OPNAME_VARIANCE';
  const variance = num(p.variance);

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        CA-4-42: when it was submitted, and by whom. CA-2-66 put both on the desktop screen
        and this one kept neither — a manager deciding money on a phone could see the amount
        and the rule, and not who was asking or how long it had been waiting.
      */}
      <header className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-11 items-center justify-center rounded-xl border border-app"
          aria-label={t('hrFix.approvalDetail.backAria')}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold">{a.title}</div>
          <div className="truncate text-[11px] text-[color:var(--text-muted)]">
            {a.subjectRef ?? KIND_LABEL[a.type]}
          </div>
        </div>
        <Badge tone="warning">{t(KIND_LABEL[a.type])}</Badge>
      </header>

      <div className="flex-1 space-y-3 px-4 pb-6">
        <div className="rounded-2xl border border-app bg-[color:var(--surface)] px-4 py-1">
          <RowLine label={t('dashA.approvalDetail.submittedByLabel')}>
            <span className="font-semibold">{who(a.submittedBy)}</span>
          </RowLine>
          <RowLine label={t('hrFix.approvalDetailExtra.submittedAt')} divider>
            <span className="tabular-nums">{formatDateTime(a.createdAt)}</span>
          </RowLine>
        </div>

        {isOpname ? (
          <div className="grid grid-cols-3 divide-x divide-[color:var(--border)] rounded-2xl border border-app bg-[color:var(--surface)]">
            <TriStat label={t('hrFix.approvalDetail.system')} value={num(p.system).toLocaleString('id-ID')} />
            <TriStat label={t('hrFix.approvalDetail.physical')} value={num(p.physical).toLocaleString('id-ID')} />
            <TriStat
              label={t('hrFix.approvalDetail.difference')}
              value={`${variance > 0 ? '+' : ''}${variance.toLocaleString('id-ID')}`}
              tone={variance === 0 ? undefined : 'danger'}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-app bg-[color:var(--surface)] px-4 py-1">
            {a.type === 'DEPOSIT_REFUND' ? (
              <>
                <RowLine label={t('hrFix.approvalDetail.gallonCondition')}>
                  <span className="text-sm font-semibold">{String(p.condition ?? '—')}</span>
                </RowLine>
                <RowLine label={t('hrFix.approvalDetail.deposit')} divider>
                  <span className="font-extrabold tabular-nums">
                    <Money amount={num(p.deposit ?? p.depositRefunded)} />
                  </span>
                </RowLine>
              </>
            ) : a.type === 'GALLON_VARIANCE' ? (
              <>
                <RowLine label={t('hrFix.approvalDetail.surplus')}>
                  <span className="text-sm font-semibold tabular-nums">
                    {num(p.excessGallons).toLocaleString('id-ID')}
                  </span>
                </RowLine>
                <RowLine label={t('hrFix.approvalDetail.depositValue')} divider>
                  <span className="font-extrabold tabular-nums">
                    <Money amount={a.amountIdr} />
                  </span>
                </RowLine>
              </>
            ) : (
              <>
                <RowLine label={t('hrFix.approvalDetail.expected')}>
                  <span className="font-semibold tabular-nums">
                    <Money amount={num(p.expected)} />
                  </span>
                </RowLine>
                <RowLine label={t('hrFix.approvalDetail.received')} divider>
                  <span className="font-semibold tabular-nums">
                    <Money amount={num(p.received)} />
                  </span>
                </RowLine>
              </>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-app bg-[color:var(--surface)] px-4 py-1">
          <RowLine label={t('hrFix.approvalDetailExtra.value')}>
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

        {/*
          * CA-4-41 — what the person who RAISED this said about it.
          *
          * Every raiser writes an explanation into `payload.note` — "hasil opname di bawah
          * jumlah yang sudah dipesan pelanggan", and so on — and no screen has ever shown
          * it. A manager was approving or refusing money with the numbers in front of them
          * and none of the sentence that explains them.
          */}
        {typeof p.note === 'string' && p.note.trim() !== '' && (
          <div className="rounded-2xl border border-app bg-[color:var(--surface)] p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
              {t('mgrFix.approvalDecide.raiserNote')}
            </div>
            <p className="mt-1 text-sm">{p.note}</p>
          </div>
        )}

        {pending && (
          <div className="rounded-2xl border border-app bg-[color:var(--surface)] p-4">
            <label
              htmlFor="m-decide-note"
              className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]"
            >
              {t('mgrFix.approvalDecide.noteLabel')}
            </label>
            <Input
              id="m-decide-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('mgrFix.approvalDecide.notePlaceholder')}
              maxLength={1000}
              className="mt-1.5"
            />
          </div>
        )}

        {a.decisionNote && (
          <div className="rounded-2xl border border-app bg-[color:var(--surface)] p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
              {t('hrFix.approvalDetail.note2')}
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
        <footer className="sticky bottom-0 flex gap-3 border-t border-app bg-[color:var(--surface)] p-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))]">
          <button
            type="button"
            onClick={() => decide('REJECT')}
            disabled={busy !== null}
            className="flex-1 rounded-xl border border-red-200 py-3 text-sm font-extrabold text-red-600 disabled:opacity-60"
          >
            {busy === 'REJECT'
              ? t('hrFix.approvalDetail.deciding')
              : t('hrFix.approvalDetail.reject')}
          </button>
          {/* CA-4-42: the third decision the server has always accepted. Ghost weight on
              purpose — it is the one that moves nothing. */}
          <button
            type="button"
            onClick={() => decide('HOLD')}
            disabled={busy !== null}
            className="flex-1 rounded-xl border border-app py-3 text-sm font-extrabold text-[color:var(--text-muted)] disabled:opacity-60"
          >
            {busy === 'HOLD' ? t('hrFix.approvalDetail.deciding') : t('dashA.approvalDetail.hold')}
          </button>
          <button
            type="button"
            onClick={() => decide('APPROVE')}
            disabled={busy !== null}
            className="flex-1 rounded-xl bg-brand-600 py-3 text-sm font-extrabold text-on-brand disabled:opacity-60"
          >
            {busy === 'APPROVE'
              ? t('hrFix.approvalDetail.deciding')
              : t('hrFix.approvalDetail.approve')}
          </button>
        </footer>
      ) : (
        <footer className="border-t border-app bg-[color:var(--surface)] p-4 pb-[max(1rem,var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] text-center text-sm text-[color:var(--text-muted)]">
          {t(
            a.status === 'APPROVED'
              ? 'hrFix.approvalDetail.alreadyApproved'
              : 'hrFix.approvalDetail.alreadyRejected',
          )}
        </footer>
      )}
    </div>
  );
}

function TriStat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="px-2 py-4 text-center">
      <div
        className={`text-xl font-extrabold tabular-nums ${tone === 'danger' ? 'text-red-600' : ''}`}
      >
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
