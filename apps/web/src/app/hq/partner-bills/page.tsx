'use client';

import { useState } from 'react';
import { Receipt } from '@phosphor-icons/react';

import { HqPageHeader } from '@/components/hq/page-header';
import { Badge, Button, Card, ErrorState, LinkButton, Money, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import {
  type GenerateBillsResult,
  type PartnerBill,
  STATUS_TONE,
  lastClosedMonth,
  monthName,
} from '@/lib/partner-bills';
import { canOpenHqPath } from '@/lib/hq-nav';
import { can } from '@/lib/roles';
import { useAsync } from '@/lib/use-async';

/**
 * HD-23 — the monthly royalty bill per partner legal entity. Always a draft first; Finance's one
 * click on the bill (approve) sends it. "Buat draf" runs the same generate n8n triggers, so
 * Finance can make the drafts before the automation exists. Customers pay the depot, so this bill
 * is the only way HQ collects its commission.
 */
export default function HqPartnerBillsPage() {
  const { t, locale } = useT();
  const { customer } = useAuth();
  const [month, setMonth] = useState(lastClosedMonth);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerateBillsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canGenerate = can('partnerBillApprove', customer?.role);
  const bills = useAsync<PartnerBill[]>(() => api.get(endpoints.partnerBills.list({ month }), true), [month]);

  async function generate() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<GenerateBillsResult>(endpoints.partnerBills.generate, { month }, true));
      bills.reload();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'PARTNER_BILL_MONTH_NOT_CLOSED'
          ? t('hq.partnerBills.monthOpen')
          : e instanceof ApiError && e.code === 'PARTNER_BILL_SOURCE_UNAVAILABLE'
            ? t('hq.partnerBills.detail.sourceDown')
            : t('hq.partnerBills.detail.failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  const rows = bills.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <HqPageHeader
        icon={Receipt}
        title={t('hq.partnerBills.title')}
        subtitle={t('hq.partnerBills.subtitle')}
        action={
          canGenerate ? (
            <Button onClick={generate} disabled={busy}>
              {busy ? t('hq.partnerBills.generating') : t('hq.partnerBills.generate')}
            </Button>
          ) : undefined
        }
      />

      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted">{t('hq.partnerBills.month')}</span>
        <input
          type="month"
          value={month}
          max={lastClosedMonth()}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {result && (
        <Card className="p-4 text-sm">
          {result.commissionRows === 0
            ? t('hq.partnerBills.resultNone', { month: monthName(result.month, locale) })
            : t('hq.partnerBills.result', {
                made: result.made,
                existing: result.existing,
                skippedZero: result.skippedZero,
                unassigned: result.unassigned,
              })}
        </Card>
      )}

      {bills.loading ? (
        <Skeleton className="h-48 w-full" />
      ) : bills.error ? (
        <ErrorState message={t('hq.partnerBills.loadError')} onRetry={bills.reload} />
      ) : rows.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.partnerBills.empty')}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((bill) => (
            <li key={bill.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{bill.legalEntityName}</p>
                  <p className="text-xs text-muted">{monthName(bill.month, locale)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Money amount={bill.totalIdr} className="font-bold tabular-nums" />
                  <Badge tone={STATUS_TONE[bill.status]}>{t(`hq.partnerBills.status.${bill.status}`)}</Badge>
                  <LinkButton href={`/hq/partner-bills/detail?id=${bill.id}`} variant="secondary">
                    {t('hq.partnerBills.open')}
                  </LinkButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted">
        {t('hq.partnerBills.hint')}{' '}
        {canOpenHqPath(customer?.role, '/hq/forms/commission') ? (
          <a className="font-medium text-brand-600 underline" href="/hq/forms/commission">
            {t('hq.partnerBills.hintLink')}
          </a>
        ) : null}
      </p>
    </div>
  );
}
