'use client';

import { Card } from '@/components/ui';
import type { DepotAdmin } from '@/lib/types';

// ponytail: a lat/lng scatter, not a tile map. Real map tiles need an external
// tile host (blocked by the app CSP / image allowlist) and a new dependency;
// this plots depots by coordinate on a normalized SVG so relative positions +
// active status read at a glance. Swap for Leaflet/Mapbox if tiles get allowlisted.

const PAD = 6; // percent padding inside the viewbox

/** Normalize a value in [min,max] to [PAD, 100-PAD]; center if the span is zero. */
function norm(v: number, min: number, max: number): number {
  if (max - min < 1e-9) return 50;
  return PAD + ((v - min) / (max - min)) * (100 - 2 * PAD);
}

export function DepotMap({ depots, onSelect }: { depots: DepotAdmin[]; onSelect: (d: DepotAdmin) => void }) {
  const pts = depots.filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng));
  if (pts.length === 0) {
    return <p className="text-sm text-muted">Belum ada depot dengan koordinat.</p>;
  }

  const lats = pts.map((d) => d.lat);
  const lngs = pts.map((d) => d.lng);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];

  return (
    <div className="flex flex-col gap-3">
      <Card className="relative aspect-[4/3] w-full overflow-hidden bg-[color:var(--surface-soft)] p-0">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(var(--border-app) 1px, transparent 1px), linear-gradient(90deg, var(--border-app) 1px, transparent 1px)',
            backgroundSize: '10% 10%',
            opacity: 0.4,
          }}
        />
        {pts.map((d) => {
          // lat grows northward -> invert Y so north is up.
          const x = norm(d.lng, minLng, maxLng);
          const y = 100 - norm(d.lat, minLat, maxLat);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelect(d)}
              title={`${d.name} · ${d.code}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span
                className={`block h-3.5 w-3.5 rounded-full ring-2 ring-white ${
                  d.active ? 'bg-brand-600' : 'bg-[color:var(--text-muted)]'
                }`}
              />
              <span className="mt-0.5 block whitespace-nowrap text-[10px] font-semibold">{d.code}</span>
            </button>
          );
        })}
      </Card>
      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600" /> Aktif
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--text-muted)]" /> Nonaktif
        </span>
        <span className="ml-auto">Posisi relatif dari koordinat depot.</span>
      </div>
    </div>
  );
}
