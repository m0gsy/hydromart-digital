import { describe, expect, it } from 'vitest';

import { layoutProspectMap, type MapDepot } from '@/lib/prospect-map-layout';
import { areaPreview } from '@/lib/service-area-text';

const depot = (over: Partial<MapDepot> = {}): MapDepot => ({
  id: 'd1',
  code: 'BKS',
  name: 'Bekasi',
  lat: -6.25,
  lng: 106.99,
  radiusKm: 3,
  area: null,
  ...over,
});
const point = (id: string, lat: number, lng: number, opportunity = false) => ({
  id,
  lat,
  lng,
  status: 'NEW',
  category: 'KOS',
  opportunity,
});
const AREA = [
  [
    { lat: -6.24, lng: 106.98 },
    { lat: -6.24, lng: 107.0 },
    { lat: -6.26, lng: 107.0 },
  ],
];

describe('layoutProspectMap', () => {
  it('draws a ring when the depot has no drawn area, and a polygon (no ring) when it has one', () => {
    const ring = layoutProspectMap({ depots: [depot()], points: [] });
    expect(ring?.rings).toHaveLength(1);
    expect(ring?.polygons).toHaveLength(0);
    const drawn = layoutProspectMap({ depots: [depot({ area: AREA })], points: [] });
    expect(drawn?.rings).toHaveLength(0);
    expect(drawn?.polygons).toHaveLength(1);
    // an empty drawn area counts as none: the radius applies
    expect(layoutProspectMap({ depots: [depot({ area: [[]] })], points: [] })?.rings).toHaveLength(1);
    // no radius, no ring
    expect(layoutProspectMap({ depots: [depot({ radiusKm: 0 })], points: [] })?.rings).toHaveLength(0);
  });

  it('skips a depot with garbage coordinates instead of drawing it at (0,0)', () => {
    const out = layoutProspectMap({
      depots: [depot(), depot({ id: 'bad', lat: Number.NaN }), depot({ id: 'zero', lat: 0, lng: 0 }), depot({ id: 'far', lat: 95 })],
      points: [],
    });
    expect(out?.depots.map((d) => d.id)).toEqual(['d1']);
  });

  it('returns null with nothing valid to draw, and lays a single point out', () => {
    expect(layoutProspectMap({ depots: [], points: [] })).toBeNull();
    expect(layoutProspectMap({ depots: [depot({ lat: Number.NaN })], points: [point('x', 91, 0)] })).toBeNull();
    const one = layoutProspectMap({ depots: [], points: [point('p', -6.2, 106.8)] });
    expect(one?.dots).toHaveLength(1);
    expect(Number.isFinite(one?.dots[0]?.x)).toBe(true);
  });

  it('carries the opportunity flag and keeps every dot inside the viewBox', () => {
    const out = layoutProspectMap({ depots: [depot()], points: [point('a', -6.2, 106.9), point('b', -6.3, 107.05, true)] });
    expect(out?.dots.map((d) => d.opportunity)).toEqual([false, true]);
    for (const d of out?.dots ?? []) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(100);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(100);
    }
  });

  it('projects exactly as areaPreview does (one depot with a drawn area, and one with a ring)', () => {
    const a = layoutProspectMap({ depots: [depot({ area: AREA })], points: [] });
    const pa = areaPreview(AREA, { lat: -6.25, lng: 106.99 }, 3);
    expect(a?.polygons.map((p) => p.points)).toEqual(pa?.polygons);
    expect(a?.depots[0]?.x).toBeCloseTo(pa?.depot?.x as number, 6);
    const r = layoutProspectMap({ depots: [depot()], points: [] });
    const pr = areaPreview(null, { lat: -6.25, lng: 106.99 }, 3);
    expect(r?.rings[0]?.r).toBeCloseTo(pr?.circle?.r as number, 6);
  });
});
