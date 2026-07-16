'use client';

import { ChartLineUp } from '@phosphor-icons/react';

import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { StubBadge, stubForecastConfidence } from '@/lib/hq/stubs';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { trendLabel } from '@/lib/forecast';
import { useT } from '@/lib/locale-context';
import { useAsync } from '@/lib/use-async';
import type { ForecastResult, Page, Product } from '@/lib/types';

const HORIZON = 14;

// Design 17a — network demand forecast. Loops the catalog and calls forecast.demand per
// product (all real). Confidence has no endpoint field → sampled per product, badged.
export default function HqForecastPage() {
  const { t } = useT();

  const data = useAsync<{ product: Product; forecast: ForecastResult }[]>(async () => {
    const catalog = await api.get<Page<Product>>(endpoints.products.browse({ limit: 12 }), true);
    const products = catalog.items.filter((p) => p.active);
    return Promise.all(
      products.map(async (product) => {
        const forecast = await api.get<ForecastResult>(
          endpoints.forecast.demand({ productId: product.id, horizonDays: HORIZON }),
          true,
        );
        return { product, forecast };
      }),
    );
  });

  const rows = data.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChartLineUp size={24} weight="fill" className="text-brand-500" />
          <div>
            <h1 className="text-2xl font-bold">{t('hq.forecast.title')}</h1>
            <p className="text-sm text-muted">{t('hq.forecast.subtitle')}</p>
          </div>
        </div>
        <Button variant="secondary" onClick={data.reload} loading={data.loading}>
          {t('hq.forecast.rebuild')}
        </Button>
      </div>

      {data.loading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{t('hq.forecast.empty')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map(({ product, forecast }) => {
            const current = Math.round(forecast.avgDaily * HORIZON);
            const confidence = stubForecastConfidence(product.id);
            return (
              <Card key={product.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{product.name}</p>
                    <p className="text-xs text-muted">{product.sku}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs font-semibold">
                    {trendLabel(forecast.trendSlope)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted">{t('hq.forecast.predicted', { n: HORIZON })}</dt>
                    <dd className="text-lg font-bold tabular-nums text-brand-700">
                      {Math.round(forecast.predictedTotal).toLocaleString('id-ID')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('hq.forecast.current')}</dt>
                    <dd className="text-lg font-bold tabular-nums">{current.toLocaleString('id-ID')}</dd>
                  </div>
                </dl>
                <div className="flex items-center gap-2 border-t border-app pt-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                    {t('hq.forecast.confidence')}
                    <StubBadge />
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.round(confidence * 100)}%` }} />
                  </div>
                  <span className="text-xs font-bold tabular-nums">{Math.round(confidence * 100)}%</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
