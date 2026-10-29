import { describe, expect, it } from 'vitest';

import {
  areaPreview,
  areaToText,
  MAX_POINTS,
  MAX_RINGS,
  parseAreaText,
} from '@/lib/service-area-text';

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

const SQUARE = [
  [
    { lat: -6.2, lng: 106.8 },
    { lat: -6.2, lng: 107 },
    { lat: -6, lng: 107 },
    { lat: -6, lng: 106.8 },
  ],
];

describe('parseAreaText', () => {
  it('reads blank as "no drawn area"', () => {
    expect(parseAreaText('', t)).toEqual({ ok: true, value: null });
    expect(parseAreaText('  \n \n\n', t)).toEqual({ ok: true, value: null });
  });

  it('reads one polygon, tolerating spaces, semicolons, CRLF and a trailing newline', () => {
    const text = '-6.2, 106.8\r\n-6.2 107.0\r\n-6.0;107\r\n-6.0,106.8\r\n';
    expect(parseAreaText(text, t)).toEqual({ ok: true, value: SQUARE });
  });

  it('splits polygons on a blank line, even one holding spaces', () => {
    const text = '0,0\n0,1\n1,1\n   \n5,5\n5,6\n6,6';
    const out = parseAreaText(text, t);
    expect(out.ok && out.value).toHaveLength(2);
  });

  it('round-trips through areaToText', () => {
    expect(parseAreaText(areaToText(SQUARE), t)).toEqual({ ok: true, value: SQUARE });
    expect(areaToText(null)).toBe('');
    expect(areaToText([])).toBe('');
    expect(areaToText(undefined)).toBe('');
  });

  it.each([
    ['a decimal comma, which would shift every number', '-6,2, 106,8\n0,0\n1,1'],
    ['a single number', '-6.2\n0,0\n1,1'],
    ['three numbers', '1,2,3\n0,0\n1,1'],
    ['a word', 'a, b\n0,0\n1,1'],
    ['latitude past 90', '91, 0\n0,0\n1,1'],
    ['longitude past 180', '0, 181\n0,0\n1,1'],
    ['a dot with no digits', '1., 2\n0,0\n1,1'],
  ])('refuses %s, naming the line', (_n, text) => {
    const out = parseAreaText(text, t);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toContain('badLine');
    expect(!out.ok && out.error).toContain('"line":1');
  });

  it('numbers the polygon and line of the bad point', () => {
    const out = parseAreaText('0,0\n0,1\n1,1\n\n0,0\nx,y\n1,1', t);
    expect(!out.ok && out.error).toContain('"ring":2');
    expect(!out.ok && out.error).toContain('"line":2');
  });

  it('wants at least three points per polygon', () => {
    const out = parseAreaText('0,0\n0,1', t);
    expect(!out.ok && out.error).toContain('tooFewPoints');
  });

  it('caps polygons and points like the server', () => {
    const ring = '0,0\n0,1\n1,1';
    const many = Array(MAX_RINGS + 1).fill(ring).join('\n\n');
    expect((parseAreaText(many, t) as { error: string }).error).toContain('tooManyRings');
    const big = Array.from({ length: MAX_POINTS + 2 }, (_, i) => `${i / 1000}, ${i / 1000}`).join(
      '\n',
    );
    expect((parseAreaText(big, t) as { error: string }).error).toContain('tooManyPoints');
  });
});

describe('areaPreview', () => {
  it('draws nothing when there is nothing to draw', () => {
    expect(areaPreview(null, null, null)).toBeNull();
    expect(areaPreview([], null, 5)).toBeNull();
  });

  it('fits every corner and the depot inside the viewBox, north up', () => {
    const preview = areaPreview(SQUARE, { lat: -6.1, lng: 106.9 }, 5)!;
    const coords = preview
      .polygons[0]!.split(' ')
      .map((p) => p.split(',').map(Number) as [number, number]);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
    // -6.0 is further north than -6.2, so it must be higher on screen (smaller y).
    expect(coords[2]![1]).toBeLessThan(coords[0]![1]);
    expect(preview.depot).not.toBeNull();
    // A drawn area replaces the radius, so the circle is not shown.
    expect(preview.circle).toBeNull();
  });

  it('shows the radius circle, in proportion, while nothing is drawn', () => {
    const preview = areaPreview(null, { lat: -6.2, lng: 106.8 }, 5)!;
    expect(preview.polygons).toEqual([]);
    expect(preview.circle).not.toBeNull();
    expect(preview.circle!.cx).toBeCloseTo(preview.depot!.x);
    expect(preview.circle!.r).toBeGreaterThan(0);
    // The circle (radius 5 km) must fit inside the box it was scaled to.
    expect(preview.circle!.cx - preview.circle!.r).toBeGreaterThanOrEqual(-0.001);
    expect(preview.circle!.cx + preview.circle!.r).toBeLessThanOrEqual(100.001);
  });

  it('draws a lone point with no radius without dividing by zero', () => {
    const preview = areaPreview(null, { lat: 1, lng: 1 }, null)!;
    expect(preview.circle).toBeNull();
    expect(Number.isFinite(preview.depot!.x)).toBe(true);
  });

  it('keeps the shape: a km-square area looks square at the equator and away from it', () => {
    for (const lat of [0, -6.2, 50]) {
      const k = Math.cos((lat * Math.PI) / 180);
      const d = 0.1;
      const ring = [
        { lat, lng: 0 },
        { lat, lng: d / k },
        { lat: lat + d, lng: d / k },
        { lat: lat + d, lng: 0 },
      ];
      const p = areaPreview([ring], null, null)!;
      const pts = p
        .polygons[0]!.split(' ')
        .map((s) => s.split(',').map(Number) as [number, number]);
      const w = Math.abs(pts[1]![0] - pts[0]![0]);
      const h = Math.abs(pts[2]![1] - pts[1]![1]);
      expect(w / h).toBeCloseTo(1, 1);
    }
  });
});
