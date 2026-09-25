import { describe, expect, it } from 'vitest';

import { layoutDepots, MAP_ASPECT } from '@/lib/depot-map-layout';

const d = (id: string, lat: number, lng: number) => ({ id, lat, lng });

// Real spots along Java, roughly the shape of the network: long east-west, short north-south.
const BEKASI = d('bks', -6.2349, 106.9896);
const BANDUNG = d('bdg', -6.9175, 107.6191);
const MALANG = d('mlg', -7.9666, 112.6326);

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  // Both axes are in % of the card's width here (y is stored as % of height), so undo that.
  Math.hypot(a.x - b.x, ((a.y - b.y) * (100 / MAP_ASPECT)) / 100);

describe('depot map layout', () => {
  it('has nothing to draw for no depots', () => {
    expect(layoutDepots([])).toEqual([]);
  });

  it('centres a lone depot', () => {
    const g = layoutDepots([BEKASI])[0]!;
    expect(g.x).toBeCloseTo(50);
    expect(g.y).toBeCloseTo(50);
    expect(g.members).toEqual([BEKASI]);
  });

  it('keeps north up and east right', () => {
    const groups = layoutDepots([BEKASI, BANDUNG, MALANG]);
    const at = (id: string) => groups.find((g) => g.first.id === id)!;
    expect(at('bks').y).toBeLessThan(at('bdg').y); // Bekasi is north of Bandung
    expect(at('bdg').y).toBeLessThan(at('mlg').y);
    expect(at('bks').x).toBeLessThan(at('mlg').x); // Malang is east of Bekasi
  });

  it('uses one scale on both axes instead of stretching to fill the card', () => {
    const groups = layoutDepots([BEKASI, MALANG]);
    const [a, b] = [groups[0]!, groups[1]!];
    // Bekasi to Malang: ~5.6° east (×cos 7° ≈ 0.99) and ~1.7° south. On one scale the drawn run
    // is ~3.3× the drawn rise; independent normalising would have drawn both across the card.
    const run = Math.abs(a.x - b.x);
    const rise = (Math.abs(a.y - b.y) / 100) * (100 / MAP_ASPECT);
    expect(run / rise).toBeGreaterThan(3);
    expect(run / rise).toBeLessThan(3.6);
  });

  it('keeps every dot and label inside the card', () => {
    for (const g of layoutDepots([BEKASI, BANDUNG, MALANG])) {
      expect(g.x).toBeGreaterThan(7.9);
      expect(g.x).toBeLessThan(92.1);
      expect(g.y).toBeGreaterThan(0);
      expect(g.y).toBeLessThan(100);
    }
  });

  it('keeps depots in different cities apart', () => {
    expect(layoutDepots([BEKASI, BANDUNG, MALANG])).toHaveLength(3);
  });

  it('merges depots that would touch into one counted group', () => {
    // Two Bekasi depots ~2 km apart, against Malang 600 km away: at that scale they overprint.
    const a = d('a', -6.2349, 106.9896);
    const b = d('b', -6.2401, 107.0012);
    const groups = layoutDepots([a, b, MALANG]);
    expect(groups).toHaveLength(2);
    const bekasi = groups.find((g) => g.members.length === 2)!;
    expect(bekasi.members.map((m) => m.id)).toEqual(['a', 'b']);
    expect(bekasi.key).toBe('a|b');
    expect(
      dist(
        bekasi,
        groups.find((g) => g !== bekasi)!,
      ),
    ).toBeGreaterThan(12);
  });

  it('separates the same two depots once the map is re-fitted to just them', () => {
    const a = d('a', -6.2349, 106.9896);
    const b = d('b', -6.2401, 107.0012);
    expect(layoutDepots([a, b])).toHaveLength(2);
  });

  it('cannot separate depots on the same spot, and says so with one group', () => {
    const groups = layoutDepots([d('a', -6.2, 106.9), d('b', -6.2, 106.9), d('c', -6.2, 106.9)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(3);
    expect(groups[0]!.x).toBeCloseTo(50);
  });

  it('does not stretch depots metres apart across the whole card', () => {
    const groups = layoutDepots([d('a', -6.2, 106.9), d('b', -6.2003, 106.9003)]);
    expect(groups).toHaveLength(1);
  });

  it('is stable: the same depots in any order make the same groups', () => {
    const one = layoutDepots([BEKASI, BANDUNG, MALANG]).map((g) =>
      g.members.map((m) => m.id).sort(),
    );
    const two = layoutDepots([MALANG, BEKASI, BANDUNG]).map((g) =>
      g.members.map((m) => m.id).sort(),
    );
    expect(one.sort()).toEqual(two.sort());
  });
});
