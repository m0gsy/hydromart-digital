/**
 * The depot form's text editor for a drawn service area, and the preview geometry for it.
 * Pure, so each rule is testable without a browser.
 *
 * Text format: one polygon per block, blocks separated by a blank line, one corner per line as
 * `lat, lng` (dot decimals). The same limits the server enforces are checked here so the person
 * sees the problem next to the box; whether a polygon crosses itself is left to the server,
 * which is the authority and says so in the save error.
 */
import type { Translate } from './addresses';

export interface LatLng {
  lat: number;
  lng: number;
}
export type AreaText = { ok: true; value: LatLng[][] | null } | { ok: false; error: string };

export const MAX_RINGS = 5;
export const MAX_POINTS = 200;

/** `[[{lat,lng},…],…]` → the text the editor shows. Empty/absent → ''. */
export function areaToText(area: LatLng[][] | null | undefined): string {
  if (!area?.length) return '';
  return area.map((ring) => ring.map((p) => `${p.lat}, ${p.lng}`).join('\n')).join('\n\n');
}

function number(token: string): number | null {
  return /^-?\d+(\.\d+)?$/.test(token) ? Number(token) : null;
}

export function parseAreaText(text: string, t: Translate): AreaText {
  const blocks = text
    .split(/\r?\n[ \t]*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return { ok: true, value: null };
  if (blocks.length > MAX_RINGS) {
    return { ok: false, error: t('hrFix.depotArea.err.tooManyRings', { max: MAX_RINGS }) };
  }

  const rings: LatLng[][] = [];
  for (const [ringIndex, block] of blocks.entries()) {
    const ring: LatLng[] = [];
    for (const [lineIndex, raw] of block.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line) continue;
      const where = { ring: ringIndex + 1, line: lineIndex + 1, value: line };
      const tokens = line.split(/[\s,;]+/).filter(Boolean);
      // A decimal comma ("-6,19, 106,8") splits into four tokens, and silently reading the
      // first two would put the depot's area in the wrong place: refuse it instead.
      if (tokens.length !== 2) return { ok: false, error: t('hrFix.depotArea.err.badLine', where) };
      const lat = number(tokens[0] as string);
      const lng = number(tokens[1] as string);
      if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { ok: false, error: t('hrFix.depotArea.err.badLine', where) };
      }
      ring.push({ lat, lng });
    }
    if (ring.length < 3) {
      return { ok: false, error: t('hrFix.depotArea.err.tooFewPoints', { ring: ringIndex + 1 }) };
    }
    if (ring.length > MAX_POINTS + 1) {
      return {
        ok: false,
        error: t('hrFix.depotArea.err.tooManyPoints', { ring: ringIndex + 1, max: MAX_POINTS }),
      };
    }
    rings.push(ring);
  }
  return { ok: true, value: rings };
}

export interface AreaPreview {
  viewBox: string;
  /** SVG `points` attribute per polygon. */
  polygons: string[];
  depot: { x: number; y: number } | null;
  /** The radius circle, shown only when there is no drawn area (radius is what applies). */
  circle: { cx: number; cy: number; r: number } | null;
}

const SIZE = 100;
const KM_PER_DEGREE = 111.32;

/**
 * Equirectangular fit of the polygons (and the depot) into a square viewBox. Longitude is
 * scaled by cos(latitude) so a square kilometre looks square; the aspect ratio is kept.
 */
export function areaPreview(
  area: LatLng[][] | null,
  depot: LatLng | null,
  radiusKm: number | null,
): AreaPreview | null {
  const points = [...(area?.flat() ?? []), ...(depot ? [depot] : [])];
  if (points.length === 0) return null;

  const midLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const px = (p: LatLng) => p.lng * k;
  const py = (p: LatLng) => -p.lat;

  const showCircle = !area?.length && depot !== null && radiusKm !== null && radiusKm > 0;
  const rDeg = showCircle ? (radiusKm as number) / KM_PER_DEGREE : 0;
  const xs = points.map(px);
  const ys = points.map(py);
  const minX = Math.min(...xs) - rDeg * (showCircle ? 1 : 0);
  const maxX = Math.max(...xs) + rDeg;
  const minY = Math.min(...ys) - rDeg;
  const maxY = Math.max(...ys) + rDeg;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = SIZE * 0.08;
  const scale = (SIZE - 2 * pad) / span;
  const fx = (x: number) => pad + (x - minX) * scale;
  const fy = (y: number) => pad + (y - minY) * scale;

  return {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    polygons: (area ?? []).map((ring) =>
      ring.map((p) => `${fx(px(p)).toFixed(2)},${fy(py(p)).toFixed(2)}`).join(' '),
    ),
    depot: depot ? { x: fx(px(depot)), y: fy(py(depot)) } : null,
    circle: showCircle && depot ? { cx: fx(px(depot)), cy: fy(py(depot)), r: rDeg * scale } : null,
  };
}
