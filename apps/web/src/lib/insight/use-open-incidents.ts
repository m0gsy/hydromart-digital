'use client';

import { api } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useInsightData, type InsightData } from '@/lib/insight/use-insight-data';
import type { DepotIncident } from '@/lib/types';

const SEVERITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/**
 * A depot's unresolved incidents: the new ones and the ones being handled, worst first.
 *
 * The server filters by one status at a time, so this is two reads shown as one answer. `source`
 * is ready only when both have landed, and failed or refused when either is, so a count taken
 * from `source.data` is never half of the picture.
 */
export function useOpenIncidents(
  depotId: string | null,
  enabled: boolean,
): { source: InsightData<DepotIncident[]>; incidents: DepotIncident[]; high: number } {
  const on = enabled && depotId != null;
  const fresh = useInsightData(
    () =>
      api.get<DepotIncident[]>(
        endpoints.incidents.list({ depotId: depotId as string, status: 'OPEN' }),
        true,
      ),
    [depotId],
    on,
  );
  const working = useInsightData(
    () =>
      api.get<DepotIncident[]>(
        endpoints.incidents.list({ depotId: depotId as string, status: 'IN_PROGRESS' }),
        true,
      ),
    [depotId],
    on,
  );
  const ready = fresh.data != null && working.data != null;
  const incidents = ready
    ? [...(fresh.data ?? []), ...(working.data ?? [])].sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt),
      )
    : [];
  const source: InsightData<DepotIncident[]> = {
    data: ready ? incidents : null,
    loading: fresh.loading || working.loading,
    forbidden: fresh.forbidden || working.forbidden,
    error: fresh.error ?? working.error,
    reload: () => {
      fresh.reload();
      working.reload();
    },
  };
  return { source, incidents, high: incidents.filter((i) => i.severity === 'HIGH').length };
}
