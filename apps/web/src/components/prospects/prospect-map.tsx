'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { ExternalLink } from '@/components/external-link';
import { Badge, Button, Card } from '@/components/ui';
import { useT } from '@/lib/locale-context';
import { labelKey, mapsUrl, STATUS_TONE } from '@/lib/prospect-labels';
import { layoutProspectMap, type MapDepot } from '@/lib/prospect-map-layout';
import type { ProspectRow } from '@/lib/types';

export type MapRow = ProspectRow & { opportunity: boolean };

const DOT_FILL: Record<string, string> = {
  INTERESTED: 'var(--warning)',
  CONVERTED: 'var(--success)',
  LOST: 'var(--danger)',
  DO_NOT_CONTACT: 'var(--danger)',
};

/**
 * Plain SVG plot (no tiles: the CSP blocks tile hosts and the app ships no map library). It draws
 * only the rows it is given, which the server already scoped; it adds no data source.
 */
export function ProspectMap({
  depots,
  rows,
  canOpen,
}: {
  depots: MapDepot[];
  rows: MapRow[];
  /** `b2bProspectWork`: only then does the side card offer "Buka". */
  canOpen: boolean;
}) {
  const { t } = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const layout = useMemo(
    () =>
      layoutProspectMap({
        depots,
        points: rows.map((r) => ({
          id: r.id,
          lat: r.latitude,
          lng: r.longitude,
          status: r.status,
          category: r.category,
          opportunity: r.opportunity,
        })),
      }),
    [depots, rows],
  );
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  if (!layout) return <p className="text-sm text-muted">{t('opsFix.prospects.map.empty')}</p>;
  const shown = new Set(layout.dots.map((d) => d.id));
  const tableRows = rows.filter((r) => shown.has(r.id));

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-2" elevated={false}>
        <svg
          viewBox={layout.viewBox}
          role="img"
          aria-label={t('opsFix.prospects.map.label')}
          className="mx-auto aspect-square w-full max-w-xl"
        >
          {layout.polygons.map((p, i) => (
            <polygon
              key={`${p.depotId}-${i}`}
              points={p.points}
              fill="var(--brand-pill)"
              fillOpacity={0.08}
              stroke="var(--brand-pill)"
              strokeWidth={0.4}
            />
          ))}
          {layout.rings.map((r) => (
            <circle
              key={r.depotId}
              cx={r.cx}
              cy={r.cy}
              r={r.r}
              fill="var(--brand-pill)"
              fillOpacity={0.06}
              stroke="var(--brand-pill)"
              strokeWidth={0.4}
              strokeDasharray="1.5 1"
            />
          ))}
          {layout.dots.map((d) => (
            <circle
              key={d.id}
              data-testid="prospect-dot"
              cx={d.x}
              cy={d.y}
              r={d.id === selectedId ? 1.8 : 1.1}
              fill={d.opportunity ? 'none' : (DOT_FILL[d.status] ?? 'var(--brand-pill)')}
              stroke={d.opportunity ? 'var(--text-muted)' : 'var(--surface)'}
              strokeWidth={d.opportunity ? 0.4 : 0.2}
              onClick={() => setSelectedId(d.id)}
            />
          ))}
          {layout.depots.map((d) => (
            <g key={d.id}>
              <rect x={d.x - 1.3} y={d.y - 1.3} width={2.6} height={2.6} fill="var(--text)" />
              <text x={d.x + 2} y={d.y + 0.8} fontSize={2.6} fill="var(--text)">
                {d.code}
              </text>
            </g>
          ))}
        </svg>
        <p className="px-2 pb-1 text-xs text-muted">{t('opsFix.prospects.map.note')}</p>
      </Card>

      {selected && (
        <Card className="flex flex-col gap-2 p-3.5" elevated={false}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{selected.name}</p>
            <Badge tone={STATUS_TONE[selected.status]}>{t(labelKey('status', selected.status))}</Badge>
          </div>
          <p className="text-xs text-muted">
            {t(labelKey('category', selected.category))}
            {selected.opportunity ? ` / ${t('opsFix.prospects.map.opportunity')}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {canOpen && !selected.opportunity && (
              <Link href={`/dashboard/prospects/detail?id=${selected.id}`} className="font-semibold text-brand-700">
                {t('opsFix.prospects.open')}
              </Link>
            )}
            <ExternalLink href={mapsUrl(selected.latitude, selected.longitude)} className="font-semibold text-brand-700 underline">
              {t('opsFix.prospects.detail.navigate')}
            </ExternalLink>
            <Button variant="secondary" onClick={() => setSelectedId(null)}>
              {t('opsFix.prospects.map.close')}
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto p-3.5" elevated={false}>
        <h3 className="mb-2 text-sm font-semibold">{t('opsFix.prospects.map.tableTitle')}</h3>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-3 font-medium">{t('opsFix.prospects.cols.name')}</th>
              <th className="py-1 pr-3 font-medium">{t('opsFix.prospects.cols.category')}</th>
              <th className="py-1 font-medium">{t('opsFix.prospects.cols.status')}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.id}>
                <td className="py-1 pr-3">
                  <button type="button" className="text-left font-semibold text-brand-700" onClick={() => setSelectedId(r.id)}>
                    {r.name}
                  </button>
                </td>
                <td className="py-1 pr-3">{t(labelKey('category', r.category))}</td>
                <td className="py-1">{t(labelKey('status', r.status))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
