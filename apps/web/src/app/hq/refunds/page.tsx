'use client';

import { useState } from 'react';
import { Receipt } from '@phosphor-icons/react';

import { Badge, Card, Chip, Money } from '@/components/ui';
import { useToast } from '@/components/toast';
import { REFUND_QUEUE_STUB, StubBadge, type RefundRequestRow } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 14a — Persetujuan refund. No HQ refund-approval endpoint exists, so the whole
// queue is stubbed; approve/reject optimistically drop the row and toast.
export default function HqRefundsPage() {
  const { t } = useT();
  const { toast } = useToast();
  const [queue, setQueue] = useState<RefundRequestRow[]>(REFUND_QUEUE_STUB);

  function decide(r: RefundRequestRow, approved: boolean) {
    // STUB: no refund-approval endpoint — Milestone D. Optimistic removal + toast.
    setQueue((q) => q.filter((x) => x.id !== r.id));
    toast(
      approved
        ? t('hq.refunds.approved', { order: r.orderNumber })
        : t('hq.refunds.rejected', { order: r.orderNumber }),
      approved ? 'success' : 'info',
    );
  }

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
        <div className="flex items-center gap-2">
          <Badge tone="warning">{t('hq.refunds.count', { n: queue.length })}</Badge>
          <StubBadge />
        </div>
      </div>

      {queue.length === 0 ? (
        <Card className="p-8">
          <p className="text-center text-sm text-muted">{t('hq.refunds.empty')}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {queue.map((r) => (
            <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {t('hq.refunds.order')} {r.orderNumber}
                  </span>
                  <Chip tone="outline">{r.method}</Chip>
                  <span className="text-xs text-muted">{r.depot}</span>
                </div>
                <p className="mt-1 text-sm">{r.reason}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {t('hq.refunds.by', { who: r.requestedBy })} · {t('hq.refunds.age', { n: r.ageHours })}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
                <Money amount={r.amount} className="text-lg font-bold text-brand-700" />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => decide(r, false)}
                    className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                  >
                    {t('hq.refunds.reject')}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(r, true)}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
                  >
                    {t('hq.refunds.approve')}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
