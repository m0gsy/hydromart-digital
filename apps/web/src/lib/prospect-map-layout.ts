import { KM_PER_DEGREE } from './service-area-text';

export interface MapDepot {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  area: { lat: number; lng: number }[][] | null;
}

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  status: string;
  category: string;
  opportunity: boolean;
}

export interface ProspectMapLayout {
  viewBox: string;
  depots: { id: string; code: string; x: number; y: number }[];
  rings: { depotId: string; cx: number; cy: number; r: number }[];
  polygons: { depotId: string; points: string }[];
  dots: { id: string; x: number; y: number; status: string; opportunity: boolean }[];
}

const SIZE = 100;
const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/**
 * One uniform equirectangular scale (the `areaPreview` projection) over every depot, drawn area,
 * radius ring and dot. A depot with garbage coordinates is skipped, not drawn at (0,0). A depot
 * has a ring ONLY when it has no drawn area: the polygon wins, as in the server's `depotServes`.
 */
export function layoutProspectMap(input: { depots: MapDepot[]; points: MapPoint[] }): ProspectMapLayout | null {
  const depots = input.depots.filter((d) => valid(d.lat, d.lng));
  const points = input.points.filter((p) => valid(p.lat, p.lng));
  const withArea = (d: MapDepot) => (d.area ?? []).filter((r) => r.length > 0);
  const all = [...depots.flatMap((d) => [{ lat: d.lat, lng: d.lng }, ...withArea(d).flat()]), ...points];
  if (all.length === 0) return null;

  const midLat = all.reduce((s, p) => s + p.lat, 0) / all.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const px = (p: { lng: number }) => p.lng * k;
  const py = (p: { lat: number }) => -p.lat;
  const rDeg = (d: MapDepot) => (withArea(d).length === 0 && d.radiusKm > 0 ? d.radiusKm / KM_PER_DEGREE : 0);

  const xs = all.map(px);
  const ys = all.map(py);
  const rMax = Math.max(0, ...depots.map(rDeg));
  const minX = Math.min(...xs) - rMax;
  const maxX = Math.max(...xs) + rMax;
  const minY = Math.min(...ys) - rMax;
  const maxY = Math.max(...ys) + rMax;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = SIZE * 0.08;
  const scale = (SIZE - 2 * pad) / span;
  const fx = (p: { lng: number }) => pad + (px(p) - minX) * scale;
  const fy = (p: { lat: number }) => pad + (py(p) - minY) * scale;

  return {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    depots: depots.map((d) => ({ id: d.id, code: d.code, x: fx(d), y: fy(d) })),
    rings: depots
      .filter((d) => rDeg(d) > 0)
      .map((d) => ({ depotId: d.id, cx: fx(d), cy: fy(d), r: rDeg(d) * scale })),
    polygons: depots.flatMap((d) =>
      withArea(d).map((ring) => ({
        depotId: d.id,
        points: ring.map((p) => `${fx(p).toFixed(2)},${fy(p).toFixed(2)}`).join(' '),
      })),
    ),
    dots: points.map((p) => ({ id: p.id, x: fx(p), y: fy(p), status: p.status, opportunity: p.opportunity })),
  };
}
