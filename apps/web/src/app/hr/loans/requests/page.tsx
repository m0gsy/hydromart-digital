'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CurrencyCircleDollar } from '@phosphor-icons/react';

import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Money,
  SectionHeader,
  Skeleton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import {
  KASBON_STATUS_LABEL,
  fmtDate,
  type LoanRequestListView,
  type LoanRequestStatus,
} from '@/lib/hr';
import { useT } from '@/lib/locale-context';
import { usePagedList } from '@/lib/use-paged-list';

const PAGE_SIZE = 25;
const STATUSES: LoanRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const TONE: Record<LoanRequestStatus, 'success' | 'neutral' | 'danger' | 'brand'> = {
  PENDING: 'brand',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/**
 * The kasbon decision queue (K1/K2).
 *
 * The approver sets the terms here and nowhere else (K3) — the applicant's form asks for an
 * amount and a reason only. `seenUpdatedAt` rides along on every decision, so two approvers
 * on one request produce one answer and one 409 rather than a silent overwrite of the first.
 */
export default function KasbonQueuePage() {
  const { t } = useT();
  const { toast } = useToast();
  const [status, setStatus] = useState<LoanRequestStatus | ''>('PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [terms, setTerms] = useState<Record<string, { installment: string; period: string }>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const list = usePagedList<LoanRequestListView>(
    (page) =>
      api
        .get<{ rows: LoanRequestListView[]; total: number }>(
          endpoints.hr.loanRequestQueue({
            page,
            pageSize: PAGE_SIZE,
            ...(status ? { status } : {}),
          }),
          true,
        )
        .then((p) => ({ items: p.rows, total: p.total })),
    [status],
  );
  const { error, loading, reload } = list;

  async function decide(row: LoanRequestListView, approve: boolean) {
    setErr(null);
    const entry = terms[row.id] ?? { installment: '', period: '' };
    const installmentAmount = Number(entry.installment);
    if (
      approve &&
      (!Number.isInteger(installmentAmount) || installmentAmount <= 0 || !entry.period)
    )
      return setErr(t('hrFix.kasbonQueue.termsRequired'));
    const reason = note[row.id]?.trim() ?? '';
    if (!approve && !reason) return setErr(t('hrFix.kasbonQueue.noteRequired'));
    setBusy(row.id);
    try {
      await api.patch(
        endpoints.hr.decideLoanRequest(row.id),
        {
          approve,
          ...(reason ? { note: reason } : {}),
          ...(approve ? { installmentAmount, startPeriod: entry.period } : {}),
          seenUpdatedAt: row.updatedAt,
        },
        true,
      );
      toast(t(approve ? 'hrFix.kasbonQueue.approved' : 'hrFix.kasbonQueue.rejected'));
      reload();
    } catch (e) {
      // 409 is not a failure the approver caused — somebody else answered first, and the
      // only useful next step is a reload, so say that rather than "gagal disimpan".
      const conflict = e instanceof ApiError && e.status === 409;
      setErr(
        conflict
          ? t('hrFix.kasbonQueue.staleHint')
          : e instanceof ApiError
            ? e.message
            : t('hrFix.kasbonQueue.decideFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SectionHeader
        title={t('hrFix.kasbonQueue.title')}
        subtitle={
          list.rows.length > 0 ? t('hrFix.kasbonQueue.subtitle', { n: list.total }) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as LoanRequestStatus | '')}
          className="surface-elevated rounded-lg border border-app px-3.5 py-2.5 text-sm"
          aria-label={t('hrFix.kasbonQueue.allStatuses')}
        >
          <option value="">{t('hrFix.kasbonQueue.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(KASBON_STATUS_LABEL[s])}
            </option>
          ))}
        </select>
        <Link
          href="/hr/loans"
          className="text-sm font-bold text-brand-700 underline underline-offset-2"
        >
          {t('hrFix.kasbonQueue.backToLoans')}
        </Link>
      </div>

      {err && (
        <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
          {err}
        </p>
      )}

      {loading && list.rows.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && list.rows.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted">
          <CurrencyCircleDollar size={32} weight="thin" />
          {t('hrFix.kasbonQueue.empty')}
        </Card>
      )}

      {list.rows.length > 0 && (
        <div className="space-y-3">
          {list.rows.map((r) => (
            <Card key={r.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {r.employeeName ?? t('hrFix.payroll.unnamedEmployee')}
                    {r.employeeCode ? ` · ${r.employeeCode}` : ''}
                  </p>
                  <p className="text-xs text-muted">{fmtDate(r.createdAt)}</p>
                </div>
                <p className="font-bold tabular-nums">
                  <Money amount={Number(r.amount)} />
                </p>
                <Badge tone={TONE[r.status]}>{t(KASBON_STATUS_LABEL[r.status])}</Badge>
              </div>
              <p className="text-sm">
                <span className="text-muted">{t('hrFix.kasbonQueue.reason')}: </span>
                {r.reason}
              </p>

              {r.status === 'PENDING' && (
                <div className="space-y-3 border-t border-app pt-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t('hrFix.kasbonQueue.installment')}>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={terms[r.id]?.installment ?? ''}
                        onChange={(e) =>
                          setTerms((s) => ({
                            ...s,
                            [r.id]: { period: s[r.id]?.period ?? '', installment: e.target.value },
                          }))
                        }
                      />
                    </Field>
                    <Field label={t('hrFix.kasbonQueue.startPeriod')}>
                      <Input
                        type="month"
                        value={terms[r.id]?.period ?? ''}
                        onChange={(e) =>
                          setTerms((s) => ({
                            ...s,
                            [r.id]: {
                              installment: s[r.id]?.installment ?? '',
                              period: e.target.value,
                            },
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <Field label={t('hrFix.kasbonQueue.note')}>
                    <Input
                      value={note[r.id] ?? ''}
                      onChange={(e) => setNote((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button loading={busy === r.id} onClick={() => decide(r, true)}>
                      {t('hrFix.kasbonQueue.approve')}
                    </Button>
                    <Button
                      variant="secondary"
                      loading={busy === r.id}
                      onClick={() => decide(r, false)}
                    >
                      {t('hrFix.kasbonQueue.reject')}
                    </Button>
                  </div>
                </div>
              )}

              {r.status === 'REJECTED' && r.decisionNote && (
                <p className="text-xs text-[color:var(--danger)]">{r.decisionNote}</p>
              )}
            </Card>
          ))}
        </div>
      )}

      {list.hasMore && (
        <div className="flex justify-center pb-4">
          <Button variant="secondary" loading={loading} onClick={list.loadMore}>
            {t('shop.catalog.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
