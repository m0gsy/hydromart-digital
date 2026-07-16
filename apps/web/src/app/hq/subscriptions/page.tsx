'use client';

import { ArrowsClockwise } from '@phosphor-icons/react';

import { Card } from '@/components/ui';
import { SUBSCRIPTION_PLANS_STUB, StubBadge } from '@/lib/hq/stubs';
import { useT } from '@/lib/locale-context';

// Design 18c — gallon subscriptions. The subscriptions endpoint is customer-scoped, so a
// network subscriber aggregate has no source → the whole screen is sample data (badged).
export default function HqSubscriptionsPage() {
  const { t } = useT();
  const total = SUBSCRIPTION_PLANS_STUB.reduce((n, p) => n + p.subscribers, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ArrowsClockwise size={24} weight="fill" className="text-brand-500" />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {t('hq.subscriptions.title')}
            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-800">
              {t('hq.subscriptions.beta')}
            </span>
            <StubBadge />
          </h1>
          <p className="text-sm text-muted">{t('hq.subscriptions.subtitle')}</p>
        </div>
      </div>

      <p className="text-[12.5px] text-muted">{t('hq.subscriptions.note')}</p>

      <Card className="flex flex-col gap-1 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('hq.subscriptions.total')}</p>
        <p className="text-2xl font-bold tabular-nums">{total.toLocaleString('id-ID')}</p>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[440px] text-sm">
          <thead>
            <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">{t('hq.subscriptions.product')}</th>
              <th className="px-4 py-3 font-medium">{t('hq.subscriptions.frequency')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('hq.subscriptions.subscribers')}</th>
              <th className="px-4 py-3 font-medium">{t('hq.subscriptions.next')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {SUBSCRIPTION_PLANS_STUB.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.productName}</td>
                <td className="px-4 py-3 text-muted">{p.frequency}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {t('hq.subscriptions.subscriberCount', { n: p.subscribers })}
                </td>
                <td className="px-4 py-3 text-muted">{p.nextRun}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
