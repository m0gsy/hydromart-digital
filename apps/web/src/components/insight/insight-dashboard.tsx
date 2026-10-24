'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { DateRangeBar, type DepotOption } from '@/components/insight/date-range-bar';
import { InsightTabs } from '@/components/insight/insight-tabs';
import { OverviewTab } from '@/components/insight/tabs/overview';
import { CenterState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { resolveTab, visibleTabs, type InsightTabId } from '@/lib/insight/access';
import {
  groupingsFor,
  isValidRange,
  previousRange,
  rangeFor,
  yearAgoRange,
  type Grouping,
  type Preset,
} from '@/lib/insight/range';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useT } from '@/lib/locale-context';
import { useQueryState } from '@/lib/use-query-param';
import { todayWib } from '@/lib/wib';
import type { Depot } from '@/lib/types';

/**
 * The tabbed dashboard, shared by `/hq/dashboard` and `/dashboard/insight`.
 *
 * One page per console with the tab in `?tab=`, not a dynamic segment: the app is exported as
 * static files for the native shells, and every other detail screen already moves its
 * variable into the query for that reason.
 */
export function InsightDashboard() {
  const { t } = useT();
  const { customer } = useAuth();
  const role = customer?.role;
  const [tabParam, setTabParam] = useQueryState('tab');

  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState(() => {
    const today = todayWib();
    return { from: today, to: today };
  });
  const [grouping, setGrouping] = useState<Grouping>('day');
  const [depotParam, setDepotParam] = useState('');

  // One clock reading for the page: a window that moved between two widgets' requests would
  // make the same screen disagree with itself.
  const now = useMemo(() => new Date(), []);

  const range = useMemo(
    () => rangeFor(preset, now, preset === 'custom' ? custom : undefined),
    [preset, now, custom],
  );
  const valid = isValidRange(range);
  const prev = useMemo(() => previousRange(range), [range]);
  const year = useMemo(() => yearAgoRange(range), [range]);
  const groupings = useMemo(() => groupingsFor(range), [range]);

  // The grouping must be one the window supports: a year read by the day is unreadable.
  useEffect(() => {
    const first = groupings[0];
    if (first && !groupings.includes(grouping)) setGrouping(first);
  }, [groupings, grouping]);

  // The depots in the caller's reach. A role the server will not list them for simply gets no
  // picker, and its figures are narrowed by the server on its own.
  const depotList = useInsightData(
    () => api.getCached<Depot[]>(endpoints.depots.scope, true),
    [],
    role != null,
  );
  const depots: DepotOption[] = useMemo(
    () => (depotList.data ?? []).map((d) => ({ id: d.id, name: d.name })),
    [depotList.data],
  );
  // A role that reaches exactly one depot IS looking at that depot: per-depot figures (a
  // target) need no choice from it.
  const depotId = depotParam || (depots.length === 1 ? (depots[0]?.id ?? '') : '');

  if (!customer) return <Skeleton className="h-96 w-full" />;
  const tabs = visibleTabs(role);
  const active = resolveTab(role, tabParam);
  if (!active) {
    return <CenterState icon={<Lock size={48} weight="thin" />} title={t('insight.denied')} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">{t('insight.title')}</h1>
        <p className="text-sm text-muted">{t('insight.subtitle')}</p>
      </div>

      <InsightTabs
        tabs={tabs}
        active={active.id}
        onSelect={(id: InsightTabId) => setTabParam(id)}
      />

      <DateRangeBar
        preset={preset}
        onPreset={setPreset}
        custom={custom}
        onCustom={setCustom}
        valid={valid}
        grouping={grouping}
        groupings={groupings}
        onGrouping={setGrouping}
        depots={depots}
        depotId={depotParam}
        onDepot={setDepotParam}
      />

      <div
        role="tabpanel"
        id={`insight-panel-${active.id}`}
        aria-labelledby={`insight-tab-${active.id}`}
      >
        {valid ? (
          active.id === 'overview' && (
            <OverviewTab
              ctx={{
                role,
                range,
                prev,
                year,
                grouping,
                depotIds: depotParam ? [depotParam] : undefined,
                depotId: depotId || null,
              }}
            />
          )
        ) : (
          <p className="text-sm text-muted">{t('insight.range.invalid')}</p>
        )}
      </div>
    </div>
  );
}
