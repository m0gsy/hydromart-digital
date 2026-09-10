'use client';

import { useState } from 'react';

import { useConfirm } from '@/components/confirm';
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
import { KASBON_STATUS_LABEL, fmtDate, type LoanRequest, type LoanRequestStatus } from '@/lib/hr';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';

const TONE: Record<LoanRequestStatus, 'success' | 'neutral' | 'danger' | 'brand'> = {
  PENDING: 'brand',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/**
 * Employee self-service: raise a kasbon and follow the decision.
 *
 * The form asks for two things and only two (K3). The instalment and the month it starts
 * are the approver's to set, because they are the terms of a debt — a field the applicant
 * can fill is a field the applicant can argue about later.
 */
export default function MyKasbonPage() {
  const { t } = useT();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const requests = useAsync<LoanRequest[]>(
    () => api.get<LoanRequest[]>(endpoints.hr.myLoanRequests, true),
    [],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) return setErr(t('hrFix.myKasbon.amountRequired'));
    if (!reason.trim()) return setErr(t('hrFix.myKasbon.reasonRequired'));
    setSaving(true);
    try {
      await api.post(
        endpoints.hr.submitLoanRequest,
        { amount: value, reason: reason.trim() },
        true,
      );
      toast(t('hrFix.myKasbon.submitted'));
      setAmount('');
      setReason('');
      requests.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : t('hrFix.myKasbon.submitFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id: string) {
    const ok = await confirm({
      title: t('hrFix.myKasbon.cancel'),
      message: t('hrFix.myKasbon.cancelConfirm'),
      confirmLabel: t('hrFix.myKasbon.cancel'),
    });
    if (!ok) return;
    try {
      await api.patch(endpoints.hr.cancelLoanRequest(id), {}, true);
      toast(t('hrFix.myKasbon.cancelled'));
      requests.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('hrFix.myKasbon.cancelFailed'), 'error');
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <SectionHeader title={t('hrFix.myKasbon.title')} subtitle={t('hrFix.myKasbon.subtitle')} />

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-3">
          <Field label={t('hrFix.myKasbon.amount')}>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('hrFix.myKasbon.amountHint')}
            />
          </Field>
          <Field label={t('hrFix.myKasbon.reason')}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('hrFix.myKasbon.reasonHint')}
            />
          </Field>
          {err && (
            <p className="text-sm font-medium text-[color:var(--danger)]" role="alert">
              {err}
            </p>
          )}
          <Button type="submit" loading={saving} className="w-full">
            {t('hrFix.myKasbon.apply')}
          </Button>
          <p className="text-xs text-muted">{t('hrFix.myKasbon.termsHint')}</p>
        </form>
      </Card>

      {requests.loading && <Skeleton className="h-24" />}
      {requests.error && <ErrorState message={requests.error} onRetry={requests.reload} />}
      {requests.data && (
        <Card className="divide-y divide-[color:var(--border)]">
          {requests.data.length === 0 && (
            <p className="p-5 text-sm text-muted">{t('hrFix.myKasbon.empty')}</p>
          )}
          {requests.data.map((r) => (
            <div key={r.id} className="space-y-1 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold tabular-nums">
                  <Money amount={Number(r.amount)} />
                </p>
                <Badge tone={TONE[r.status]}>{t(KASBON_STATUS_LABEL[r.status])}</Badge>
              </div>
              <p className="text-sm">{r.reason}</p>
              <p className="text-xs text-muted">{fmtDate(r.createdAt)}</p>
              {r.status === 'REJECTED' && r.decisionNote && (
                <p className="text-xs text-[color:var(--danger)]">
                  {t('hrFix.myKasbon.rejectionReason', { note: r.decisionNote })}
                </p>
              )}
              {r.status === 'APPROVED' && (
                <p className="text-xs text-muted">{t('hrFix.myKasbon.approvedTerms')}</p>
              )}
              {r.status === 'PENDING' && (
                <Button variant="secondary" onClick={() => cancel(r.id)}>
                  {t('hrFix.myKasbon.cancel')}
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
