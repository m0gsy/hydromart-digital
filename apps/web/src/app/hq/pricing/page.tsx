'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Tag } from '@phosphor-icons/react';

import { Card, ErrorState, Money, Skeleton } from '@/components/ui';
import { useToast } from '@/components/toast';
import { StubBadge, stubOverrideCount } from '@/lib/hq/stubs';
import { api, ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { computeEffective } from '@/lib/pricing';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { Page, PriceOverrideProposalItem, Product } from '@/lib/types';

// Design 7a — Tata kelola harga. Base prices are real (catalog basePrice). The depot→HQ
// override-approval queue (right) is now real (depot-service price-overrides). Only the
// per-product override counts on the base list have no aggregate endpoint (badged).
export default function HqPricingPage() {
  const { t } = useT();
  const { toast } = useToast();
  const catalog = useAsync<Page<Product>>(() => api.get(endpoints.products.browse({ limit: 50 })));
  const queueQ = useAsync<Page<PriceOverrideProposalItem>>(() =>
    api.get(endpoints.priceOverrides.queue({ limit: 50 }), true),
  );
  const [deciding, setDeciding] = useState<string | null>(null);

  async function decide(p: PriceOverrideProposalItem, approved: boolean) {
    setDeciding(p.id);
    try {
      await api.post(approved ? endpoints.priceOverrides.approve(p.id) : endpoints.priceOverrides.reject(p.id), {}, true);
      toast(
        approved
          ? t('hq.pricing.queue.approved', { product: p.productName })
          : t('hq.pricing.queue.rejected', { product: p.productName }),
        approved ? 'success' : 'info',
      );
      queueQ.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'error');
    } finally {
      setDeciding(null);
    }
  }

  const products = catalog.data?.items ?? [];
  const queue = queueQ.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Tag size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.pricing.title')}</h1>
            <p className="text-sm text-muted">{t('hq.pricing.subtitle')}</p>
          </div>
        </div>
        <Link
          href="/hq/forms/pricing-rule"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700"
        >
          ＋ {t('hq.pricing.newRule')}
        </Link>
      </div>

      <p className="text-[12.5px] text-muted">{t('hq.pricing.note')}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Harga dasar jaringan — base is real, override counts are STUB */}
        <Card className="flex flex-col p-5">
          <h2 className="mb-3 font-semibold">{t('hq.pricing.base.title')}</h2>
          {catalog.loading ? (
            <Skeleton className="h-48 w-full" />
          ) : catalog.error ? (
            <ErrorState message={catalog.error} onRetry={catalog.reload} />
          ) : products.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{t('hq.pricing.base.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="border-b border-app text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2 font-medium">{t('hq.pricing.base.product')}</th>
                    <th className="pb-2 text-right font-medium">{t('hq.pricing.base.price')}</th>
                    <th className="pb-2 text-right font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {t('hq.pricing.base.overridesCol')}
                        <StubBadge />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5">
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted">{p.sku}</p>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        <Money amount={p.basePrice} />
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-muted">
                        {t('hq.pricing.base.overrides', { n: stubOverrideCount(p.id) })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Override menunggu — REAL (depot-service price-override queue) */}
        <Card className="flex flex-col p-5">
          <h2 className="mb-3 font-semibold">{t('hq.pricing.queue.title')}</h2>
          {queueQ.loading ? (
            <Skeleton className="h-48 w-full" />
          ) : queueQ.error ? (
            <ErrorState message={queueQ.error} onRetry={queueQ.reload} />
          ) : queue.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">{t('hq.pricing.queue.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {queue.map((p) => {
                const proposed = computeEffective(p.currentPrice, {
                  productId: p.productId,
                  adjustType: p.adjustType,
                  value: p.value,
                }).effective;
                return (
                  <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-app p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{p.productName}</span>
                    </div>
                    <p className="text-xs text-muted">
                      {t('hq.pricing.queue.by', { who: `#${p.proposedBy.slice(0, 8)}`, depot: p.depotName })}
                    </p>
                    {p.note ? <p className="text-xs text-muted">{p.note}</p> : null}
                    <p className="flex items-center gap-2 text-sm">
                      <span className="text-muted line-through">
                        <Money amount={p.currentPrice} />
                      </span>
                      <span aria-hidden>→</span>
                      <span className="font-semibold text-brand-700">
                        <Money amount={proposed} />
                      </span>
                    </p>
                    <div className="flex justify-end gap-2 border-t border-app pt-2">
                      <button
                        type="button"
                        onClick={() => decide(p, false)}
                        disabled={deciding === p.id}
                        className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        {t('hq.pricing.queue.reject')}
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(p, true)}
                        disabled={deciding === p.id}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-700 disabled:opacity-50"
                      >
                        {t('hq.pricing.queue.approve')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
