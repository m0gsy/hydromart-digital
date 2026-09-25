/**
 * Where each depot goes on the map card, and which depots are too close to draw apart.
 *
 * The first map normalised latitude and longitude to the card independently, so a network
 * that runs east-west along Java (Bekasi to Malang is ~630 km wide and ~200 km tall) was
 * stretched into a square: distances lied, and two depots in one city landed on top of each
 * other with their labels overprinted. Two rules fix both:
 *
 *  - ONE scale for both axes (longitude shrunk by cos(latitude), so a degree east is not
 *    drawn as long as a degree north), fitted to the card and centred in it;
 *  - depots that would touch are merged into a group, which the map draws as one counted
 *    bubble. Clicking it re-fits the map to just those depots, so they spread apart.
 *
 * Pure and framework-free so the geometry can be tested without a DOM.
 */

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
}

export interface MapGroup<T extends MapPoint> {
  /** Stable across renders for the same members (the React key). */
  key: string;
  /** Position in % of the card's width / height, ready for `left` / `top`. */
  x: number;
  y: number;
  /** A group is never empty: this is its first member, for callers that need only one. */
  first: T;
  members: T[];
}

/** Card shape, width over height. Must match the `aspect-video` class on the card. */
export const MAP_ASPECT = 16 / 9;

/** Empty margin on every side, in % of the card's width, so a dot and its label never clip. */
const PAD = 8;

/**
 * Smallest extent (degrees, ~1 km) the map zooms to. Without it two depots 50 m apart would be
 * stretched across the whole card as if they were far apart.
 */
const MIN_SPAN_DEG = 0.01;

/** Depots closer than this (in % of the card's width) share one bubble. */
const MERGE_DIST = 12;

export function layoutDepots<T extends MapPoint>(items: T[]): MapGroup<T>[] {
  if (items.length === 0) return [];

  const cardH = 100 / MAP_ASPECT;
  const midLat = items.reduce((s, p) => s + p.lat, 0) / items.length;
  const kx = Math.cos((midLat * Math.PI) / 180);

  // Degrees of latitude everywhere: east-west scaled down, north-south as is (north is up).
  const raw = items.map((member) => ({ member, x: member.lng * kx, y: member.lat }));
  const rx = raw.map((p) => p.x);
  const ry = raw.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...rx),
    Math.max(...rx),
    Math.min(...ry),
    Math.max(...ry),
  ];

  const scale = Math.min(
    (100 - 2 * PAD) / Math.max(maxX - minX, MIN_SPAN_DEG),
    (cardH - 2 * PAD) / Math.max(maxY - minY, MIN_SPAN_DEG),
  );
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];

  // Positions in % of the card's WIDTH on both axes, so a distance means the same either way.
  const placed = raw.map((p) => ({
    member: p.member,
    x: 50 + (p.x - cx) * scale,
    y: cardH / 2 - (p.y - cy) * scale,
  }));

  const groups: { x: number; y: number; first: (typeof placed)[number]; members: typeof placed }[] =
    [];
  for (const p of placed) {
    const near = groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) < MERGE_DIST);
    if (!near) {
      groups.push({ x: p.x, y: p.y, first: p, members: [p] });
      continue;
    }
    near.members.push(p);
    near.x = near.members.reduce((s, m) => s + m.x, 0) / near.members.length;
    near.y = near.members.reduce((s, m) => s + m.y, 0) / near.members.length;
  }

  return groups.map((g) => ({
    key: g.members.map((m) => m.member.id).join('|'),
    x: g.x,
    y: (g.y / cardH) * 100,
    first: g.first.member,
    members: g.members.map((m) => m.member),
  }));
}
