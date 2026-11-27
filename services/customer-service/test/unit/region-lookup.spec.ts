import { Logger } from '@nestjs/common';
import { reportDegraded } from '@hydromart/platform';

import { regionCodesFor, regionLevels } from '../../src/domain/region-codes';
import { RegionAsset, RegionLookup } from '../../src/infrastructure/geo/region-lookup';

jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  reportDegraded: jest.fn(),
}));

// Flat [lng, lat, ...] square ring.
const sq = (w: number, s: number, e: number, n: number) => [w, s, e, s, e, n, w, n, w, s];

// Kecamatan 320101 = 0..10 x 0..10 with a hole at 4..6 (a lake); kelurahan A = west half (0..5)
// and B = east half (5..10) except the strip 8..10 which belongs to no kelurahan.
const asset: RegionAsset = {
  adm3: [
    { c: '320101', n: 'Kec Satu', b: [0, 0, 10, 10], g: [[sq(0, 0, 10, 10), sq(4, 4, 6, 6)]] },
    { c: '320102', n: 'Kec Dua', b: [20, 0, 30, 10], g: [[sq(20, 0, 30, 10)]] },
    { c: '320103', n: 'Kec Tiga', b: [40, 0, 50, 10], g: [[sq(40, 0, 50, 10)]] },
  ],
  adm4: [
    { c: '3201010001', n: 'Kel A', p: '320101', b: [0, 0, 5, 10], g: [[sq(0, 0, 5, 10)]] },
    { c: '3201010002', n: 'Kel B', p: '320101', b: [5, 0, 8, 10], g: [[sq(5, 0, 8, 10)]] },
    // Another kecamatan's kelurahan must never answer for a point in 320101.
    { c: '3201020001', n: 'Kel C', p: '320102', b: [0, 0, 10, 10], g: [[sq(0, 0, 10, 10)]] },
  ],
};
const lookup = new RegionLookup(asset);
const at = (lat: number, lng: number) => lookup.find(lat, lng);

describe('RegionLookup.find', () => {
  it('names the kecamatan and the kelurahan a point is in', () => {
    expect(at(2, 2)).toEqual({
      kecamatan: { code: '320101', name: 'Kec Satu' },
      kelurahan: { code: '3201010001', name: 'Kel A' },
    });
    expect(at(2, 7)?.kelurahan?.code).toBe('3201010002');
    expect(at(5, 25)?.kecamatan.code).toBe('320102');
    // A kecamatan with no mapped kelurahan at all.
    expect(at(5, 45)).toEqual({ kecamatan: { code: '320103', name: 'Kec Tiga' }, kelurahan: null });
  });

  it('counts the boundary as inside', () => {
    expect(at(0, 2)?.kecamatan.code).toBe('320101');
    expect(at(2, 5)?.kelurahan).not.toBeNull();
  });

  it('gives the kecamatan alone for a point in no kelurahan', () => {
    expect(at(2, 9)).toEqual({ kecamatan: { code: '320101', name: 'Kec Satu' }, kelurahan: null });
  });

  it('is null outside every kecamatan, in a gap between them and inside a hole', () => {
    expect(at(50, 50)).toBeNull();
    expect(at(5, 15)).toBeNull();
  });

  it('is null inside a hole that no kelurahan covers', () => {
    const holey = new RegionLookup({
      adm3: [{ c: '1', n: 'K', b: [0, 0, 10, 10], g: [[sq(0, 0, 10, 10), sq(4, 4, 6, 6)]] }],
      adm4: [],
    });
    expect(holey.find(5, 5)).toBeNull();
    expect(holey.find(2, 2)?.kecamatan.code).toBe('1');
  });

  it('loads the shipped asset on first use', () => {
    // Monas is in Gambir (kecamatan 3173080), Kelurahan Gambir (3173080003).
    const hit = new RegionLookup().find(-6.1754, 106.8272);
    expect(hit?.kecamatan.code).toMatch(/^3173/);
    expect(hit?.kelurahan?.code).toMatch(/^3173/);
  });
});

describe('RegionLookup on simplified edges', () => {
  // K1 and K2 overlap on lng 4..5; K3 has no neighbour but its kelurahan sticks out of it (a gap).
  const edge = new RegionLookup({
    adm3: [
      { c: '1', n: 'K1', b: [0, 0, 5, 10], g: [[sq(0, 0, 5, 10)]] },
      { c: '2', n: 'K2', b: [4, 0, 9, 10], g: [[sq(4, 0, 9, 10)]] },
      { c: '3', n: 'K3', b: [20, 0, 25, 10], g: [[sq(20, 0, 25, 10)]] },
    ],
    adm4: [
      { c: '2a', n: 'L2', p: '2', b: [4, 0, 9, 10], g: [[sq(4, 0, 9, 10)]] },
      { c: '3a', n: 'L3', p: '3', b: [25, 0, 30, 10], g: [[sq(25, 0, 30, 10)]] },
      // Orphan: its parent kecamatan is not in the asset.
      { c: '9a', n: 'L9', p: '9', b: [40, 0, 45, 10], g: [[sq(40, 0, 45, 10)]] },
    ],
  });

  it('in an overlap takes the kecamatan whose kelurahan holds the point', () => {
    expect(edge.find(5, 4.5)).toEqual({
      kecamatan: { code: '2', name: 'K2' },
      kelurahan: { code: '2a', name: 'L2' },
    });
  });

  it('in an overlap with no kelurahan anywhere takes the first kecamatan, kelurahan null', () => {
    expect(edge.find(5, 1)?.kecamatan.code).toBe('1');
    expect(edge.find(5, 1)?.kelurahan).toBeNull();
  });

  it('in a kecamatan gap falls back to the kelurahan and its parent', () => {
    expect(edge.find(5, 27)).toEqual({
      kecamatan: { code: '3', name: 'K3' },
      kelurahan: { code: '3a', name: 'L3' },
    });
  });

  it('is null in a gap whose kelurahan has no parent in the asset', () => {
    expect(edge.find(5, 42)).toBeNull();
  });
});

describe('RegionLookup with an unreadable asset', () => {
  it('logs once, never throws, and gives no region', () => {
    const bad = new RegionLookup();
    const read = jest.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new Error('corrupt');
    });
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(bad.find(1, 1)).toBeNull();
    expect(bad.codesFor(1, 1, 'MANUAL', null).regionSource).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(reportDegraded).toHaveBeenCalledWith('region-asset');
    read.mockRestore();
    log.mockRestore();
  });
});

describe('RegionLookup.codesFor', () => {
  it('has no codes without a pin', () => {
    expect(lookup.codesFor(null, null, 'MANUAL', null)).toEqual({
      kecamatanCode: null,
      kelurahanCode: null,
      regionSource: null,
    });
  });

  it('stores both levels for a pin a person placed', () => {
    expect(lookup.codesFor(2, 2, 'MANUAL', null)).toEqual({
      kecamatanCode: '320101',
      kelurahanCode: '3201010001',
      regionSource: 'PIN',
    });
  });

  it('has no codes for a pin outside every kecamatan', () => {
    expect(lookup.codesFor(50, 50, 'MANUAL', null).regionSource).toBeNull();
  });
});

describe('regionLevels / regionCodesFor', () => {
  it.each([
    ['GPS', 20, true, true],
    ['GPS', 250, true, true],
    ['GPS', 251, true, false],
    ['GPS', 1000, true, false],
    ['GPS', 1001, false, false],
    ['GPS', null, false, false],
    ['MANUAL', null, true, true],
    ['STAFF', null, true, true],
    [null, null, true, false],
    ['IMPORT', null, true, false],
    ['COURIER', null, true, false],
  ])('%s with accuracy %s -> kecamatan %s, kelurahan %s', (source, acc, kec, kel) => {
    expect(regionLevels(source, acc)).toEqual({ kecamatan: kec, kelurahan: kel });
  });

  it('leaves kelurahan null when the pin is precise but the kelurahan is unmapped', () => {
    const hit = { kecamatan: { code: 'k', name: 'K' }, kelurahan: null };
    expect(regionCodesFor(hit, 'MANUAL', null)).toEqual({
      kecamatanCode: 'k',
      kelurahanCode: null,
      regionSource: 'PIN',
    });
  });

  it('claims nothing for a pin too coarse for a kecamatan', () => {
    const hit = { kecamatan: { code: 'k', name: 'K' }, kelurahan: null };
    expect(regionCodesFor(hit, 'GPS', 5000).regionSource).toBeNull();
  });
});
