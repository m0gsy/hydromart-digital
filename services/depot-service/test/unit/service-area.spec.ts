import {
  MAX_RINGS,
  MAX_RING_POINTS,
  parseServiceArea,
  pointInServiceArea,
} from '../../src/domain/service-area';
import { L_SHAPE, SQUARE } from '../fixtures/service-area-cases';

const ok = (input: unknown) => {
  const r = parseServiceArea(input);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
};
const fail = (input: unknown): string => {
  const r = parseServiceArea(input);
  if (r.ok) throw new Error('expected an error');
  return r.error;
};
const p = (lat: number, lng: number) => ({ lat, lng });

describe('parseServiceArea', () => {
  it('reads absent, null and empty as "no drawn area"', () => {
    expect(ok(undefined)).toBeNull();
    expect(ok(null)).toBeNull();
    expect(ok([])).toBeNull();
  });

  it('accepts valid rings and every fixture ring', () => {
    expect(ok(SQUARE)).toEqual(SQUARE);
    expect(ok(L_SHAPE)).toEqual(L_SHAPE);
  });

  it('drops a repeated closing point and collapses consecutive duplicates', () => {
    const closed = [p(0, 0), p(0, 1), p(0, 1), p(1, 1), p(1, 0), p(0, 0)];
    expect(ok([closed])).toEqual([[p(0, 0), p(0, 1), p(1, 1), p(1, 0)]]);
  });

  it('strips unknown properties from points', () => {
    const out = ok([[{ lat: 0, lng: 0, x: 1 }, p(0, 1), p(1, 1)]]);
    expect(out![0][0]).toEqual({ lat: 0, lng: 0 });
  });

  it.each([
    ['not an array', 'x', 'daftar poligon'],
    ['ring not an array', ['x'], 'poligon 1: harus berupa daftar titik'],
    ['string coordinates', [[{ lat: '1', lng: 2 }, p(0, 0), p(1, 1)]], 'koordinat yang valid'],
    ['NaN', [[p(NaN, 0), p(0, 1), p(1, 1)]], 'koordinat yang valid'],
    ['lat out of range', [[p(91, 0), p(0, 1), p(1, 1)]], 'koordinat yang valid'],
    ['lng out of range', [[p(0, 181), p(0, 1), p(1, 1)]], 'koordinat yang valid'],
    ['null point', [[null, p(0, 1), p(1, 1)]], 'koordinat yang valid'],
    ['two points', [[p(0, 0), p(0, 1)]], 'minimal 3 titik'],
    [
      'three points that are two once collapsed',
      [[p(0, 0), p(0, 0), p(0, 1), p(0, 1)]],
      'minimal 3 titik',
    ],
    ['a straight line (its closing edge doubles back)', [[p(0, 0), p(0, 1), p(0, 2)]], 'berbalik'],
    [
      'a sliver smaller than a square metre',
      [[p(0, 0), p(0, 0.000001), p(0.000001, 0)]],
      'satu garis',
    ],
  ])('rejects %s', (_n, input, msg) => {
    expect(fail(input)).toContain(msg);
  });

  it('rejects a bow-tie (self-crossing ring)', () => {
    expect(fail([[p(0, 0), p(1, 1), p(0, 1), p(1, 0)]])).toContain('berpotongan');
  });

  it('rejects an edge that touches a non-neighbouring edge', () => {
    // The last corner lands exactly on the first edge's line.
    expect(fail([[p(0, 0), p(0, 4), p(4, 4), p(4, 2), p(0, 2), p(2, 0)]])).toContain('berpotongan');
  });

  it('rejects a corner that rests on a non-neighbouring edge, from every side', () => {
    // P4 = (0,2) lies on the edge P0-P1: touching, not crossing. Each rotation makes a
    // different endpoint of the earlier edge the one that lands on the later edge.
    const [p0, p1, p2, p3, p4] = [p(0, 0), p(0, 4), p(4, 4), p(4, 2), p(0, 2)];
    for (const ring of [
      [p0, p1, p2, p3, p4], // the corner is on a later edge's span (d2)
      [p4, p3, p2, p1, p0], // the earlier edge starts on it (d3)
      [p3, p4, p0, p1, p2], // the earlier edge ends on it (d4)
      [p1, p2, p3, p4, p0], // the later edge starts on it (d1)
    ]) {
      expect(fail([ring])).toContain('berpotongan');
    }
  });

  it('tells collinear overlapping edges from collinear disjoint ones', () => {
    // Edges (0,0)-(0,3) and (0,2)-(0,5)... laid on one line: overlap is rejected.
    expect(fail([[p(0, 0), p(0, 3), p(2, 3), p(2, 5), p(0, 5), p(0, 2), p(1, 1)]])).toContain(
      'berpotongan',
    );
    // Two edges on one line with a gap between them are fine (an "E"-like notch).
    expect(
      ok([[p(0, 0), p(0, 1), p(1, 1), p(1, 2), p(0, 2), p(0, 3), p(2, 3), p(2, 0)]]),
    ).not.toBeNull();
  });

  it('keeps a point just outside a concave corner out', () => {
    expect(pointInServiceArea(p(-6.05, 106.9000001), L_SHAPE)).toBe(false);
  });

  it('rejects a zero-width spike', () => {
    expect(fail([[p(0, 0), p(0, 2), p(0, 1), p(1, 1), p(1, 0)]])).toContain('berbalik');
  });

  it('numbers the offending polygon', () => {
    expect(fail([SQUARE[0], [p(0, 0), p(0, 1)]])).toContain('poligon 2');
  });

  it('caps rings and points', () => {
    expect(fail(Array(MAX_RINGS + 1).fill(SQUARE[0]))).toContain(`maksimal ${MAX_RINGS}`);
    const big = Array.from({ length: MAX_RING_POINTS + 2 }, (_, i) => p(i / 1e4, (i % 2) / 1e4));
    expect(fail([big])).toContain(`maksimal ${MAX_RING_POINTS}`);
  });

  it('rejects a ring that is over the ceiling only after duplicates are collapsed away', () => {
    // MAX + 1 raw points that stay distinct: caught by the second ceiling check.
    const circle = Array.from({ length: MAX_RING_POINTS + 1 }, (_, i) => {
      const a = (2 * Math.PI * i) / (MAX_RING_POINTS + 1);
      return p(0.01 * Math.sin(a), 0.01 * Math.cos(a));
    });
    expect(fail([circle])).toContain(`maksimal ${MAX_RING_POINTS}`);
  });

  it('accepts exactly the point ceiling', () => {
    const circle = Array.from({ length: MAX_RING_POINTS }, (_, i) => {
      const a = (2 * Math.PI * i) / MAX_RING_POINTS;
      return p(0.01 * Math.sin(a), 0.01 * Math.cos(a));
    });
    expect(ok([circle])![0]).toHaveLength(MAX_RING_POINTS);
  });

  it('accepts a clockwise and a counter-clockwise ring alike', () => {
    const ccw = [p(0, 0), p(0, 1), p(1, 1), p(1, 0)];
    const cw = [...ccw].reverse();
    expect(pointInServiceArea(p(0.5, 0.5), ok([ccw])!)).toBe(true);
    expect(pointInServiceArea(p(0.5, 0.5), ok([cw])!)).toBe(true);
  });
});
