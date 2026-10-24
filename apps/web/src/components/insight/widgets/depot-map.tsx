'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import type { InsightCtx } from '@/components/insight/context';
import { WidgetCard } from '@/components/insight/widget-card';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { isHq } from '@/lib/roles';
import type { DepotAdmin, Page } from '@/lib/types';

// Fetched on demand, as on the HQ home: most opens of the dashboard never scroll to it.
const DepotMap = dynamic(() => import('@/components/dashboard/depot-map').then((m) => m.DepotMap), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

/** Where the depots are, for head office: the same map the HQ home draws, opening a depot on click. */
export function DepotMapCard({ ctx }: { ctx: InsightCtx }) {
  const { t } = useT();
  const router = useRouter();
  const enabled = isHq(ctx.role);
  const depots = useInsightData(
    () => api.get<Page<DepotAdmin>>(endpoints.depots.manage({ limit: 100 }), true),
    [],
    enabled,
  );
  if (!enabled) return null;
  return (
    <WidgetCard
      title={t('insight.depotMap.title')}
      source={depots}
      isEmpty={(d) => d.items.length === 0}
      emptyText={t('insight.depotMap.empty')}
      detailHref="/hq/depots"
    >
      {(d) => (
        <DepotMap depots={d.items} onSelect={(x) => router.push(`/hq/depots/detail?id=${x.id}`)} />
      )}
    </WidgetCard>
  );
}
