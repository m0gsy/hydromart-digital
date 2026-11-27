'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Lock } from '@phosphor-icons/react';

import { ProspectMap, type MapRow } from '@/components/prospects/prospect-map';
import { RequireAuth } from '@/components/require-auth';
import { CenterState, ErrorState, Field, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDepot } from '@/lib/depot-context';
import { endpoints } from '@/lib/endpoints';
import { CURSOR_PAGE_SIZE, fetchAllCursor } from '@/lib/fetch-all-cursor';
import { useT } from '@/lib/locale-context';
import type { MapDepot } from '@/lib/prospect-map-layout';
import { can } from '@/lib/roles';
import type { Depot, Page, ProspectPage, ProspectRow } from '@/lib/types';

const SELECT = 'surface-elevated w-full rounded-lg border border-app px-3.5 py-2.5 text-sm';

type PublicDepot = Depot & { serviceRadiusKm?: number; serviceArea?: { lat: number; lng: number }[][] | null };

function Body() {
  const { t } = useT();
  const { customer } = useAuth();
  const { depots: scope, selectedId } = useDepot();
  const work = can('b2bProspectWork', customer?.role);

  const [rows, setRows] = useState<ProspectRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [areas, setAreas] = useState<PublicDepot[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [opportunity, setOpportunity] = useState(false);
  const [opportunityRows, setOpportunityRows] = useState<ProspectRow[]>([]);
  const [opportunityDenied, setOpportunityDenied] = useState(false);
  const [focus, setFocus] = useState('');
  const [kecamatan, setKecamatan] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    Promise.all([
      fetchAllCursor<ProspectRow>((cursor) =>
        api.get<ProspectPage<ProspectRow>>(
          endpoints.prospects.list({ limit: CURSOR_PAGE_SIZE, cursor, depotId: selectedId ?? undefined }),
          true,
        ),
      ),
      api.get<Page<PublicDepot>>(endpoints.depots.browse({ limit: 100, includeArea: true }), true),
    ])
      .then(([prospects, depots]) => {
        if (!alive) return;
        setRows(prospects.items);
        setTruncated(prospects.truncated);
        setAreas(depots.items);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [selectedId, nonce]);

  // Opportunity rows are fetched only when asked for; a depot role is refused (403) and the toggle goes away.
  useEffect(() => {
    if (!opportunity) return;
    let alive = true;
    fetchAllCursor<ProspectRow>((cursor) =>
      api.get<ProspectPage<ProspectRow>>(endpoints.prospects.list({ scope: 'map', limit: CURSOR_PAGE_SIZE, cursor }), true),
    )
      .then((r) => alive && setOpportunityRows(r.items))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 403) setOpportunityDenied(true);
        setOpportunity(false);
      });
    return () => {
      alive = false;
    };
  }, [opportunity]);

  const mapDepots: MapDepot[] = useMemo(() => {
    const ids = new Set(scope.map((d) => d.id));
    return areas
      .filter((d) => ids.has(d.id) && (!focus || d.id === focus))
      .map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        lat: d.lat as number,
        lng: d.lng as number,
        radiusKm: d.serviceRadiusKm ?? 0,
        area: d.serviceArea ?? null,
      }));
  }, [areas, scope, focus]);

  const kecamatans = useMemo(
    () => [...new Set(rows.map((r) => r.kecamatanCode).filter((k): k is string => !!k))].sort(),
    [rows],
  );
  const shown: MapRow[] = useMemo(
    () => [
      ...rows
        .filter((r) => (!focus || r.ownerDepotId === focus) && (!kecamatan || r.kecamatanCode === kecamatan))
        .map((r) => ({ ...r, opportunity: false })),
      ...(opportunity && !focus
        ? opportunityRows.filter((r) => !kecamatan || r.kecamatanCode === kecamatan).map((r) => ({ ...r, opportunity: true }))
        : []),
    ],
    [rows, opportunityRows, opportunity, focus, kecamatan],
  );

  if (loading) return <Skeleton className="m-4 h-96" />;
  if (failed) return <ErrorState message={t('opsFix.prospects.map.loadFailed')} onRetry={() => setNonce((n) => n + 1)} />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Link href="/dashboard/prospects" className="text-sm font-semibold text-brand-700">
        {t('opsFix.prospects.detail.back')}
      </Link>
      <h1 className="text-xl font-bold">{t('opsFix.prospects.map.title')}</h1>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('opsFix.prospects.map.focusDepot')} htmlFor="prospect-map-depot">
          <select id="prospect-map-depot" className={SELECT} value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">{t('opsFix.prospects.map.allDepots')}</option>
            {scope.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} - {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('opsFix.prospects.map.kecamatan')} htmlFor="prospect-map-kecamatan">
          <select id="prospect-map-kecamatan" className={SELECT} value={kecamatan} onChange={(e) => setKecamatan(e.target.value)}>
            <option value="">{t('opsFix.prospects.map.allKecamatan')}</option>
            {kecamatans.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!opportunityDenied && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={opportunity} onChange={(e) => setOpportunity(e.target.checked)} />
          {t('opsFix.prospects.map.showOpportunity')}
        </label>
      )}
      {truncated && (
        <p role="status" className="text-xs font-medium text-[color:var(--warning)]">
          {t('opsFix.prospects.map.truncated', { n: rows.length })}
        </p>
      )}
      <ProspectMap depots={mapDepots} rows={shown} canOpen={work} />
    </div>
  );
}

function Gate() {
  const { t } = useT();
  const { customer } = useAuth();
  if (!can('b2bProspectRead', customer?.role)) {
    return (
      <CenterState title={t('opsFix.prospects.gateTitle')} icon={<Lock size={40} weight="fill" />}>
        {t('opsFix.prospects.gateBody')}
      </CenterState>
    );
  }
  return <Body />;
}

export default function ProspectMapPage() {
  return (
    <RequireAuth>
      <Gate />
    </RequireAuth>
  );
}
