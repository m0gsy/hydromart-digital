import 'reflect-metadata';

import { ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegionAsset, RegionLookup } from '../../src/infrastructure/geo/region-lookup';
import { UnservedDemandPrismaRepository } from '../../src/infrastructure/prisma/unserved-demand.prisma.repository';
import { InternalRegionsController } from '../../src/modules/internal-regions.controller';
import { MAX_LOOKUP_POINTS, RegionLookupDto, UnservedDemandQueryDto } from '../../src/modules/dto/regions.dto';

/** HD-20c: the pin lookup and the unserved-demand summary dashboard-service reads. */
const sq = (w: number, s: number, e: number, n: number) => [w, s, e, s, e, n, w, n, w, s];
const asset: RegionAsset = {
  adm3: [{ c: '320101', n: 'Kec Satu', b: [0, 0, 10, 10], g: [[sq(0, 0, 10, 10)]] }],
  adm4: [{ c: '3201010001', n: 'Kel A', p: '320101', b: [0, 0, 5, 10], g: [[sq(0, 0, 5, 10)]] }],
};

describe('RegionLookup.nameOf', () => {
  it('names a kecamatan and a kelurahan code, null for an unknown one or an unreadable asset', () => {
    const l = new RegionLookup(asset);
    expect(l.nameOf('320101')).toBe('Kec Satu');
    expect(l.nameOf('3201010001')).toBe('Kel A');
    expect(l.nameOf('999')).toBeNull();
    const broken = new RegionLookup({} as never);
    expect(broken.nameOf('320101')).toBeNull();
    expect(broken.available()).toBe(false);
    expect(l.available()).toBe(true);
  });
});

describe('InternalRegionsController', () => {
  const summary = {
    kecamatan: [{ code: '320101', count: 4 }],
    kelurahan: [{ code: null, kecamatan: '320101', count: 1 }, { code: '3201010001', kecamatan: '320101', count: 3 }],
    grid: [{ cell: '1:2', count: 4 }],
    bands: [{ band: '>10', count: 4 }],
  };
  const unserved = { summarize: jest.fn().mockResolvedValue(summary) };
  const c = new InternalRegionsController(new RegionLookup(asset), unserved as never, {} as never);

  it('looks every pin up, in order, with its 1 km cell; a pin in no kecamatan has nulls', () => {
    const r = c.lookup({ points: [{ lat: 2, lng: 2 }, { lat: 50, lng: 50 }] } as never);
    expect(r.points[0]).toMatchObject({ kecamatan: { code: '320101', name: 'Kec Satu' }, kelurahan: { code: '3201010001', name: 'Kel A' } });
    expect(r.points[0].gridCell).toMatch(/^-?\d+:-?\d+$/);
    expect(r.points[1]).toMatchObject({ kecamatan: null, kelurahan: null });
  });

  it('answers 503, not an empty region, when the boundary asset cannot be read', () => {
    const broken = new InternalRegionsController(new RegionLookup({} as never), unserved as never, {} as never);
    expect(() => broken.lookup({ points: [{ lat: 2, lng: 2 }] } as never)).toThrow(ServiceUnavailableException);
  });

  it('names the unserved cells and leaves a missing kelurahan code unnamed', async () => {
    const r = await c.unservedDemand({ month: '2026-11' });
    expect(unserved.summarize).toHaveBeenCalledWith('2026-11');
    expect(r.kecamatan).toEqual([{ code: '320101', name: 'Kec Satu', count: 4 }]);
    expect(r.kelurahan).toEqual([{ code: null, name: null, kecamatan: '320101', count: 1 }, { code: '3201010001', name: 'Kel A', kecamatan: '320101', count: 3 }]);
    expect(r.grid).toEqual(summary.grid);
    expect(r.bands).toEqual(summary.bands);
  });

  it('bounds its inputs', async () => {
    const n = async (cls: new () => object, body: object) => (await validate(plainToInstance(cls, body))).length;
    expect(await n(RegionLookupDto, { points: [{ lat: 1, lng: 1 }] })).toBe(0);
    expect(await n(RegionLookupDto, { points: [] })).toBeGreaterThan(0);
    expect(await n(RegionLookupDto, { points: Array.from({ length: MAX_LOOKUP_POINTS + 1 }, () => ({ lat: 1, lng: 1 })) })).toBeGreaterThan(0);
    expect(await n(RegionLookupDto, { points: [{ lat: 91, lng: 1 }] })).toBeGreaterThan(0);
    expect(await n(UnservedDemandQueryDto, { month: '2026-11' })).toBe(0);
    expect(await n(UnservedDemandQueryDto, { month: '2026-13' })).toBeGreaterThan(0);
  });
});

describe('UnservedDemandPrismaRepository.summarize', () => {
  it('groups one month four ways in SQL and maps the counts', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([{ kecamatanCode: 'K', _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ kecamatanCode: 'K', kelurahanCode: null, _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ gridCell: '1:2', _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ distanceBand: '3-5', _count: { _all: 5 } }]);
    const repo = new UnservedDemandPrismaRepository({ unservedDemand: { groupBy } } as never);
    await expect(repo.summarize('2026-11')).resolves.toEqual({
      kecamatan: [{ code: 'K', count: 5 }],
      kelurahan: [{ code: null, kecamatan: 'K', count: 2 }],
      grid: [{ cell: '1:2', count: 5 }],
      bands: [{ band: '3-5', count: 5 }],
    });
    expect(groupBy.mock.calls.every(([a]) => a.where.monthKey === '2026-11')).toBe(true);
  });
});
