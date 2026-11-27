'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { CoverageView } from '@/components/prospects/coverage-view';
import { ProspectTable } from '@/components/prospects/prospect-table';
import { useProspectPages } from '@/components/prospects/use-prospect-pages';
import { RequireAuth } from '@/components/require-auth';
import { Button, CenterState, ErrorState, Field, Input, Segmented, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { useT } from '@/lib/locale-context';
import { labelKey, PROSPECT_CATEGORIES } from '@/lib/prospect-labels';
import { PROSPECT_STATUSES } from '@/lib/prospect-status';
import { can, canViewProspects } from '@/lib/roles';
import type { ProspectAssignee, ProspectDetail, ProspectRow } from '@/lib/types';
import { useQueryState } from '@/lib/use-query-param';

type Tab = 'all' | 'mine' | 'opportunity' | 'coverage';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';
const PAGE = 50;

function Body() {
  const { t } = useT();
  const { customer } = useAuth();
  const { selectedId, depots } = useDepot();
  const role = customer?.role;
  const read = can('b2bProspectRead', role);
  const work = can('b2bProspectWork', role);
  const manage = can('b2bProspectManage', role);
  const reassign = can('b2bProspectReassign', role);

  const [tabParam, setTab] = useQueryState('tab');
  const [status, setStatus] = useQueryState('status');
  const [category, setCategory] = useQueryState('category');
  const [kecamatan, setKecamatan] = useQueryState('kecamatan');
  const [assigned, setAssigned] = useQueryState('assigned');
  const [q, setQ] = useQueryState('q');
  const [draft, setDraft] = useState(q);

  // A Work-only role lands on "Milik saya" and sees no other tab.
  const tab: Tab = (tabParam as Tab) || (read ? 'all' : 'mine');

  // The opportunity tab exists only for network roles: the server answers 403 to a depot role.
  const [canSeeOpportunity, setCanSeeOpportunity] = useState(false);
  useEffect(() => {
    if (!read) return;
    let alive = true;
    api
      .get(endpoints.prospects.list({ scope: 'map', limit: 1 }), true)
      .then(() => alive && setCanSeeOpportunity(true))
      .catch(() => alive && setCanSeeOpportunity(false));
    return () => {
      alive = false;
    };
  }, [read]);

  const listTab = tab === 'all' || tab === 'mine' || tab === 'opportunity';
  const common = { status, category, kecamatanCode: kecamatan, q, limit: PAGE };
  const pages = useProspectPages<ProspectRow | ProspectDetail>(
    listTab
      ? (cursor) =>
          tab === 'mine'
            ? endpoints.prospects.mine({ ...common, cursor })
            : endpoints.prospects.list({
                ...common,
                cursor,
                scope: tab === 'opportunity' ? 'map' : 'work',
                depotId: selectedId ?? undefined,
                assigned: manage && tab === 'all' ? assigned : undefined,
              })
      : null,
    [tab, status, category, kecamatan, q, assigned, selectedId, manage],
  );

  // Names of the people on the page: one assignees call per distinct owner depot (cached).
  const names = useRef(new Map<string, Map<string, string>>());
  const [, bump] = useState(0);
  useEffect(() => {
    if (!manage || tab !== 'all') return;
    const wanted = [...new Set(pages.items.filter((r) => r.assignedToId && r.ownerDepotId).map((r) => r.ownerDepotId as string))]
      .filter((d) => !names.current.has(d))
      .slice(0, 3);
    for (const depotId of wanted) {
      names.current.set(depotId, new Map());
      api
        .get<ProspectAssignee[]>(endpoints.prospects.assignees(depotId), true)
        .then((list) => {
          names.current.set(depotId, new Map(list.map((s) => [s.id, s.name])));
          bump((n) => n + 1);
        })
        .catch(() => {
          // 503 or no access: the list still renders, names fall back to "Staf lain".
        });
    }
  }, [pages.items, manage, tab]);

  const depotCodes = useMemo(() => new Map(depots.map((d) => [d.id, d.code])), [depots]);
  const depotCode = (id: string | null) => (id ? (depotCodes.get(id) ?? '-') : t('opsFix.prospects.noDepot'));
  const assigneeLabel = (id: string | null) => {
    if (!id) return t('opsFix.prospects.unassigned');
    if (id === customer?.id || tab === 'mine') return t('opsFix.prospects.me');
    for (const m of names.current.values()) if (m.has(id)) return m.get(id) as string;
    return t('opsFix.prospects.otherStaff');
  };

  const tabs = [
    ...(read ? [{ value: 'all' as const, label: t('opsFix.prospects.tabs.all') }] : []),
    ...(work ? [{ value: 'mine' as const, label: t('opsFix.prospects.tabs.mine') }] : []),
    ...(read && canSeeOpportunity ? [{ value: 'opportunity' as const, label: t('opsFix.prospects.tabs.opportunity') }] : []),
    ...(read ? [{ value: 'coverage' as const, label: t('opsFix.prospects.tabs.coverage') }] : []),
  ];

  if (pages.status === 403) {
    return (
      <CenterState title={t('opsFix.prospects.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.prospects.gateBody')}
      </CenterState>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('opsFix.prospects.title')}</h1>
        {read && (
          <Link href="/dashboard/prospects/map" className="text-sm font-semibold text-brand-700">
            {t('opsFix.prospects.mapOpen')}
          </Link>
        )}
      </div>
      <Segmented value={tab} options={tabs} onChange={(v) => setTab(v)} label={t('opsFix.prospects.title')} />

      {tab === 'coverage' ? (
        <CoverageView depotId={selectedId ?? undefined} />
      ) : (
        <>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(draft.trim());
            }}
          >
            <Field label={t('opsFix.prospects.filters.status')} htmlFor="prospect-f-status">
              <select id="prospect-f-status" className={SELECT} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t('opsFix.prospects.filters.allStatuses')}</option>
                {PROSPECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(labelKey('status', s))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('opsFix.prospects.filters.category')} htmlFor="prospect-f-category">
              <select id="prospect-f-category" className={SELECT} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t('opsFix.prospects.filters.allCategories')}</option>
                {PROSPECT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(labelKey('category', c))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('opsFix.prospects.filters.kecamatan')} htmlFor="prospect-f-kecamatan">
              <Input
                id="prospect-f-kecamatan"
                inputMode="numeric"
                maxLength={20}
                value={kecamatan}
                onChange={(e) => setKecamatan(e.target.value.trim())}
              />
            </Field>
            {manage && tab === 'all' && (
              <Field label={t('opsFix.prospects.filters.assigned')} htmlFor="prospect-f-assigned">
                <select id="prospect-f-assigned" className={SELECT} value={assigned} onChange={(e) => setAssigned(e.target.value)}>
                  <option value="">{t('opsFix.prospects.filters.assignedAll')}</option>
                  <option value="me">{t('opsFix.prospects.filters.assignedMe')}</option>
                  <option value="none">{t('opsFix.prospects.filters.assignedNone')}</option>
                </select>
              </Field>
            )}
            <div className="sm:col-span-2">
              <Field label={t('opsFix.prospects.filters.search')} htmlFor="prospect-f-q">
                <div className="flex gap-2">
                  <Input id="prospect-f-q" maxLength={120} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <Button type="submit" variant="secondary">
                    {t('opsFix.prospects.filters.apply')}
                  </Button>
                </div>
              </Field>
            </div>
          </form>

          {tab === 'opportunity' && <p className="text-xs text-muted">{t('opsFix.prospects.opportunityNote')}</p>}

          {pages.loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : pages.error ? (
            <ErrorState message={t('opsFix.prospects.loadFailed')} onRetry={pages.reload} />
          ) : pages.items.length === 0 ? (
            <CenterState title={tab === 'mine' ? t('opsFix.prospects.emptyMine') : t('opsFix.prospects.empty')} />
          ) : (
            <>
              <ProspectTable
                rows={pages.items}
                depotCode={depotCode}
                assigneeLabel={assigneeLabel}
                linkable={tab === 'opportunity' ? reassign : work}
              />
              {pages.moreError && (
                <p role="alert" className="text-center text-xs font-medium text-[color:var(--danger)]">
                  {pages.moreError}
                </p>
              )}
              {pages.hasMore && (
                <div className="flex justify-center">
                  <Button variant="secondary" onClick={pages.more} loading={pages.loadingMore}>
                    {t('common.loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!canViewProspects(customer?.role)) {
    return (
      <CenterState title={t('opsFix.prospects.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.prospects.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ProspectsPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
