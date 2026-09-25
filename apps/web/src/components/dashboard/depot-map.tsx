'use client';

import { ArrowLeft } from '@phosphor-icons/react';
import { useState } from 'react';

import { Card } from '@/components/ui';
import { layoutDepots } from '@/lib/depot-map-layout';
import { useT } from '@/lib/locale-context';
import type { DepotAdmin } from '@/lib/types';

// ponytail: a lat/lng scatter, not a tile map. Real map tiles need an external
// tile host (blocked by the app CSP / image allowlist) and a new dependency;
// this plots depots by coordinate on one uniform scale (see depot-map-layout.ts) so
// distances read true and active status shows at a glance. Swap for Leaflet/Mapbox if
// tiles get allowlisted.

const dotClass = (active: boolean) => (active ? 'bg-brand-600' : 'bg-[color:var(--text-muted)]');

export function DepotMap({
  depots,
  onSelect,
}: {
  depots: DepotAdmin[];
  onSelect: (d: DepotAdmin) => void;
}) {
  const { t } = useT();
  // Ids, not objects: a reload swaps the depot objects and the zoom must survive it.
  const [zoomIds, setZoomIds] = useState<string[] | null>(null);

  const pts = depots.filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng));
  if (pts.length === 0) {
    return <p className="text-sm text-muted">{t('hrFix.depotMap.empty')}</p>;
  }

  const zoomed = zoomIds ? pts.filter((d) => zoomIds.includes(d.id)) : [];
  const scope = zoomed.length > 0 ? zoomed : pts;
  const groups = layoutDepots(scope);
  // Zoomed in and still one bubble: these depots share a spot, so a list is the only way apart.
  const stacked = zoomed.length > 0 && groups.length === 1 && scope.length > 1;

  return (
    <div className="flex flex-col gap-3">
      {zoomed.length > 0 && (
        <button
          type="button"
          onClick={() => setZoomIds(null)}
          className="flex items-center gap-1.5 self-start text-sm font-medium text-brand-700"
        >
          <ArrowLeft size={16} weight="bold" />
          {t('hrFix.depotMap.all')}
        </button>
      )}
      <Card className="relative aspect-video w-full overflow-hidden bg-[color:var(--surface-soft)] p-0">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
            backgroundSize: '10% 10%',
            opacity: 0.4,
          }}
        />
        {groups.map((g) => {
          const { first } = g;
          const many = g.members.length > 1;
          const cities = new Set(g.members.map((m) => m.city));
          const label = !many
            ? first.code
            : cities.size === 1
              ? first.city
              : t('hrFix.depotMap.count', { n: g.members.length });
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => (many ? setZoomIds(g.members.map((m) => m.id)) : onSelect(first))}
              title={many ? label : `${first.name} · ${first.code}`}
              aria-label={
                many
                  ? t('hrFix.depotMap.groupAria', { n: g.members.length, place: label })
                  : first.name
              }
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              style={{ left: `${g.x}%`, top: `${g.y}%` }}
            >
              {many ? (
                <span
                  className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white ring-2 ring-white ${dotClass(
                    g.members.some((m) => m.active),
                  )}`}
                >
                  {g.members.length}
                </span>
              ) : (
                <span
                  className={`block h-3.5 w-3.5 rounded-full ring-2 ring-white ${dotClass(first.active)}`}
                />
              )}
              <span className="mt-0.5 block max-w-24 truncate text-[10px] font-semibold">
                {label}
              </span>
            </button>
          );
        })}
      </Card>
      {stacked && (
        <Card className="flex flex-col divide-y divide-[color:var(--border)] p-0">
          <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
            {t('hrFix.depotMap.stacked', { n: scope.length })}
          </p>
          {scope.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelect(d)}
              className="flex items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-[color:var(--surface-soft)]"
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(d.active)}`} />
              <span className="font-medium">{d.name}</span>
              <span className="text-muted">{d.code}</span>
            </button>
          ))}
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />
          {t('hrFix.depotMap.active')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--text-muted)]" />
          {t('hrFix.depotMap.inactive')}
        </span>
        <span className="sm:ml-auto">{t('hrFix.depotMap.caption')}</span>
      </div>
    </div>
  );
}
