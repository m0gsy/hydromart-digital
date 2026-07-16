'use client';

import { useState } from 'react';
import { Receipt } from '@phosphor-icons/react';

import { Badge, Card, Chip, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Page, RefundQueueItem } from '@/lib/types';

// Design 14a — Persetujuan refund. Real payment-service track: cross-depot refunds above
// the HQ threshold (Rp 100k) awaiting approval. Depot & order-number enrichment is not
// owned by payment-service (residual gap noted below); amount/method/reason/decision are real.
function hoursAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
}

export default function HqRefundsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const queue = useAsync<Page<RefundQueueItem>>(() => api.get(endpoints.refunds.queue({ limit: 100 }), true));
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(r: RefundQueueItem, approved: boolean) {
    setBusyId(r.id);
    const ref = r.orderId.slice(0, 8);
    try {
      await api.post(approved ? endpoints.refunds.approve(r.id) : endpoints.refunds.reject(r.id), {}, true);
      toast(
        approved ? t('hq.refunds.approved', { order: ref }) : t('hq.refunds.rejected', { order: ref }),
        approved ? 'success' : 'info',
      );
      queue.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('hq.refunds.approveError'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (queue.loading) return <Skeleton className="h-96 w-full" />;
  if (queue.error) return <ErrorState message={t('hq.refunds.loadError')} onRetry={queue.reload} />;

  const items = queue.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.refunds.title')}</h1>
            <p className="text-sm text-muted">{t('hq.refunds.subtitle')}</p>
          </div>
        </div>
        <Badge tone="warning">{t('hq.refunds.count', { n: items.length })}</Badge>
      </div>

      {items.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.refunds.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((r) => (
            <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {t('hq.refunds.order')} {r.orderId.slice(0, 8)}
                  </span>
                  <Chip tone="outline">{r.method}</Chip>
                </div>
                <p className="mt-1 text-sm">{r.refundReason ?? '—'}</p>
                <p className="mt-0.5 text-xs text-muted">{t('hq.refunds.age', { n: hoursAgo(r.updatedAt) })}</p>
              </div>
              <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
                <Money amount={r.amount} className="text-lg font-bold text-brand-700" />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => decide(r, false)}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    {t('hq.refunds.reject')}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => decide(r, true)}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700 disabled:opacity-50"
                  >
                    {t('hq.refunds.approve')}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted">{t('hq.refunds.enrichNote')}</p>
    </div>
  );
}
