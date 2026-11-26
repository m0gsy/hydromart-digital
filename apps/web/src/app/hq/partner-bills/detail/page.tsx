'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';

import { Badge, Button, Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { type PartnerBill, STATUS_TONE, monthName } from '@/lib/partner-bills';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';
import { useQueryParam } from '@/lib/use-query-param';

/** HD-23 — one bill: its lines and what each is made of, with Setujui & kirim and Batalkan by capability. */
export default function HqPartnerBillDetailPage() {
  const { t, locale } = useT();
  const { customer } = useAuth();
  const id = useQueryParam('id');
  const canDecide = can('partnerBillApprove', customer?.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string } | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const bill = useAsync<PartnerBill>(() => api.get(endpoints.partnerBills.detail(id), true), [id]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      setVoiding(false);
      setReason('');
      bill.reload();
    } catch (e) {
      setError({ code: e instanceof ApiError ? e.code : undefined });
    } finally {
      setBusy(false);
    }
  }

  const b = bill.data;
  const message =
    error?.code === 'BANK_ACCOUNT_MISSING'
      ? t('hq.partnerBills.detail.bankMissing')
      : error?.code === 'PARTNER_BILL_NO_RECIPIENTS'
        ? t('hq.partnerBills.detail.noRecipients')
        : error?.code === 'PARTNER_BILL_SENDING'
          ? t('hq.partnerBills.detail.sending')
        : error?.code === 'PARTNER_BILL_SOURCE_UNAVAILABLE'
          ? t('hq.partnerBills.detail.sourceDown')
          : error
            ? t('hq.partnerBills.detail.failed')
            : null;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/hq/partner-bills" className="flex items-center gap-1 text-sm text-muted">
        <ArrowLeft size={16} /> {t('hq.partnerBills.detail.back')}
      </Link>

      {bill.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : bill.error || !b ? (
        <ErrorState message={t('hq.partnerBills.loadError')} onRetry={bill.reload} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{b.legalEntityName}</h1>
              <p className="text-sm text-muted">{monthName(b.month, locale)}</p>
            </div>
            <div className="flex items-center gap-4">
              <Money amount={b.totalIdr} className="text-xl font-bold tabular-nums" />
              <Badge tone={STATUS_TONE[b.status]}>{t(`hq.partnerBills.status.${b.status}`)}</Badge>
            </div>
          </div>

          {b.status === 'SENT' && b.sentAt && (
            <p className="text-sm text-muted">
              {t('hq.partnerBills.detail.sentAt', { at: new Date(b.sentAt).toLocaleString(locale === 'id' ? 'id-ID' : 'en-GB') })}
              {' · '}
              {t('hq.partnerBills.recipients', { n: b.recipients })}
              {b.bank &&
                ` · ${t('hq.partnerBills.detail.bank', {
                  bank: b.bank.bankName,
                  number: b.bank.bankAccountNumber,
                  holder: b.bank.bankAccountHolder,
                })}`}
            </p>
          )}
          {b.status === 'VOID' && (
            <p className="text-sm text-muted">{t('hq.partnerBills.detail.voidedFor', { reason: b.voidReason ?? '' })}</p>
          )}

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              {t('hq.partnerBills.detail.lines')}
            </h2>
            <ul className="flex flex-col divide-y divide-border">
              {(b.lines ?? []).map((line) => (
                <li key={line.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{line.label}</p>
                    <p className="text-xs text-muted">
                      {t('hq.partnerBills.detail.basis', {
                        rows: line.basis.rows,
                        from: line.basis.from,
                        to: line.basis.to,
                      })}
                      {line.basis.reversalRows > 0 &&
                        ` · ${t('hq.partnerBills.detail.basisReversal', {
                          n: line.basis.reversalRows,
                          idr: `Rp${line.basis.reversalIdr.toLocaleString('id-ID')}`,
                        })}`}
                    </p>
                  </div>
                  <Money amount={line.amountIdr} className="font-semibold tabular-nums" />
                </li>
              ))}
            </ul>
          </Card>

          {message && (
            <p role="alert" className="text-sm text-danger">
              {message}{' '}
              {error?.code === 'BANK_ACCOUNT_MISSING' && (
                <Link className="font-medium underline" href="/hq/legal-entities">
                  {t('hq.partnerBills.detail.bankMissingLink')}
                </Link>
              )}
            </p>
          )}

          {canDecide && (b.status === 'DRAFT' || b.status === 'SENDING' || b.status === 'SENT') && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                {(b.status === 'DRAFT' || b.status === 'SENDING') && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t('hq.partnerBills.detail.approveConfirm'))) {
                        void act(() => api.post(endpoints.partnerBills.approve(b.id), {}, true));
                      }
                    }}
                  >
                    {busy ? t('hq.partnerBills.detail.approving') : t('hq.partnerBills.detail.approve')}
                  </Button>
                )}
                {!voiding && b.status !== 'SENDING' && (
                  <Button variant="secondary" disabled={busy} onClick={() => setVoiding(true)}>
                    {t('hq.partnerBills.detail.void')}
                  </Button>
                )}
              </div>
              {voiding && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-muted" htmlFor="void-reason">
                    {t('hq.partnerBills.detail.voidReason')}
                  </label>
                  <textarea
                    id="void-reason"
                    value={reason}
                    maxLength={300}
                    onChange={(e) => setReason(e.target.value)}
                    className="rounded-lg border border-border bg-surface p-2 text-sm"
                    rows={2}
                  />
                  <div className="flex gap-3">
                    <Button
                      disabled={busy || reason.trim().length < 3}
                      onClick={() => void act(() => api.post(endpoints.partnerBills.void(b.id), { reason: reason.trim() }, true))}
                    >
                      {t('hq.partnerBills.detail.voidConfirm')}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setVoiding(false)}>
                      {t('hq.partnerBills.detail.voidCancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
