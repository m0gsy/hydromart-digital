'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import type { InsightCtx } from '@/components/insight/context';
import { DateRangeBar, type DepotOption } from '@/components/insight/date-range-bar';
import { InsightTabs } from '@/components/insight/insight-tabs';
import { CashTab } from '@/components/insight/tabs/cash';
import { CouriersTab } from '@/components/insight/tabs/couriers';
import { CustomersTab } from '@/components/insight/tabs/customers';
import { FinanceTab } from '@/components/insight/tabs/finance';
import { GallonsTab } from '@/components/insight/tabs/gallons';
import { MeterTab } from '@/components/insight/tabs/meter';
import { OperationsTab } from '@/components/insight/tabs/operations';
import { OverviewTab } from '@/components/insight/tabs/overview';
import { PeopleTab } from '@/components/insight/tabs/people';
import { SalesTab } from '@/components/insight/tabs/sales';
import { CenterState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { endpoints } from '@/lib/endpoints';
import { canViewInsight, resolveTab, visibleTabs, type InsightTabId } from '@/lib/insight/access';
import {
  groupingsFor,
  isValidRange,
  comparisonFor,
  rangeFor,
  type Grouping,
  type Preset,
} from '@/lib/insight/range';
import { useInsightData } from '@/lib/insight/use-insight-data';
import { useInsightStrings, useT } from '@/lib/locale-context';
import { useQueryState } from '@/lib/use-query-param';
import { todayWib } from '@/lib/wib';
import type { Depot } from '@/lib/types';

/** The body of the tab in view. One place maps a tab id to its component. */
function TabBody({ id, ctx }: { id: InsightTabId; ctx: InsightCtx }) {
  if (id === 'sales') return <SalesTab ctx={ctx} />;
  if (id === 'operations') return <OperationsTab ctx={ctx} />;
  if (id === 'customers') return <CustomersTab ctx={ctx} />;
  if (id === 'finance') return <FinanceTab ctx={ctx} />;
  if (id === 'gallons') return <GallonsTab ctx={ctx} />;
  if (id === 'people') return <PeopleTab ctx={ctx} />;
  if (id === 'cash') return <CashTab ctx={ctx} />;
  if (id === 'couriers') return <CouriersTab ctx={ctx} />;
  if (id === 'meter') return <MeterTab ctx={ctx} />;
  return <OverviewTab ctx={ctx} />;
}

/**
 * The tabbed dashboard, shared by `/hq/dashboard` and `/dashboard/insight`.
 *
 * One page per console with the tab in `?tab=`, not a dynamic segment: the app is exported as
 * static files for the native shells, and every other detail screen already moves its
 * variable into the query for that reason.
 */
/** How often the wall-screen view re-reads its figures. */
const TV_REFRESH_MS = 60_000;

export function InsightDashboard() {
  const ready = useInsightStrings();
  return ready ? <InsightDashboardBody /> : <Skeleton className="h-64 w-full" />;
}

function InsightDashboardBody() {
  const { t } = useT();
  const { customer } = useAuth();
  const role = customer?.role;
  const [tabParam, setTabParam] = useQueryState('tab');
  // `?tv=1` is the wall-screen view: no controls, larger type, and the figures re-read on a
  // timer. The timer pauses while the page is hidden, so a forgotten tab does not keep asking.
  const [tvParam] = useQueryState('tv');
  const tv = tvParam === '1';
  const [tick, setTick] = useState(0);

  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState(() => {
    const today = todayWib();
    return { from: today, to: today };
  });
  const [grouping, setGrouping] = useState<Grouping>('day');
  const [depotParam, setDepotParam] = useState('');

  // One clock reading for the page: a window that moved between two widgets' requests would
  // make the same screen disagree with itself.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!tv) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setNow(new Date());
      setTick((n) => n + 1);
    }, TV_REFRESH_MS);
    return () => clearInterval(id);
  }, [tv]);

  const range = useMemo(
    () => rangeFor(preset, now, preset === 'custom' ? custom : undefined),
    [preset, now, custom],
  );
  const valid = isValidRange(range);
  const comparison = useMemo(() => comparisonFor(range, now), [range, now]);
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
    role != null && canViewInsight(role),
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

  const ctx: InsightCtx = {
    role,
    range,
    prev: comparison.prev,
    year: comparison.year,
    partial: comparison.partial,
    comparable: comparison.comparable,
    grouping,
    depotIds: depotParam ? [depotParam] : undefined,
    depotId: depotId || null,
    depotNames: Object.fromEntries(depots.map((d) => [d.id, d.name])),
  };

  return (
    <div className={`flex flex-col gap-5 ${tv ? 'text-lg' : ''}`}>
      <div>
        <h1 className={`${tv ? 'text-3xl' : 'text-xl'} font-bold`}>{t('insight.title')}</h1>
        <p className="text-sm text-muted">{t('insight.subtitle')}</p>
      </div>

      {!tv && (
        <InsightTabs
          tabs={tabs}
          active={active.id}
          onSelect={(id: InsightTabId) => setTabParam(id)}
        />
      )}

      {!tv && (
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
      )}

      <div
        role="tabpanel"
        id={`insight-panel-${active.id}`}
        aria-labelledby={`insight-tab-${active.id}`}
      >
        {!valid ? (
          <p className="text-sm text-muted">{t('insight.range.invalid')}</p>
        ) : depotList.loading ? (
          // The depots in reach decide what a widget asks for (one depot in reach IS the depot in
          // view), so wait for them rather than ask twice: once without, once with.
          <Skeleton className="h-64 w-full" />
        ) : (
          <TabBody key={tick} id={active.id} ctx={ctx} />
        )}
      </div>
    </div>
  );
}
