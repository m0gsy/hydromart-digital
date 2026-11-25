import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MeterService } from '../../src/application/services/meter.service';
import { MeterVolumeController } from '../../src/modules/meter-volume.controller';
import { MeterVolumeDto } from '../../src/modules/dto/meter-reading.dto';

/*
 * HD-15: the water through a depot's meter over day ranges, for maintenance by volume. Only a
 * closed day counts; a day without a closing, or with closing below opening, is not a reading
 * day. One read per depot however many ranges it has.
 */
const D = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const row = (date: string, openingM3: number, closingM3: number | null) => ({ date, openingM3, closingM3 });

function service(rows: ReturnType<typeof row>[]): { service: MeterService; list: jest.Mock } {
  const list = jest.fn(async (_d: string, from: string, to: string) => rows.filter((r) => r.date >= from && r.date <= to));
  return {
    service: new MeterService({ listForRange: list } as never, {} as never, {} as never, {} as never),
    list,
  };
}
const one = (s: MeterService, from: string, to: string) => s.volumes([{ depotId: D, from, to }]).then((r) => r[0]);

describe('MeterService.volumes (HD-15)', () => {
  it('sums closing minus opening over the closed days and says how many days it rests on', async () => {
    const { service: s } = service([row('2026-11-01', 100, 101.25), row('2026-11-02', 101.25, 102), row('2026-11-03', 102, null)]);
    await expect(one(s, '2026-11-01', '2026-11-04')).resolves.toEqual({ m3: 2, readingDays: 2, spanDays: 4 });
  });

  it('leaves out a closing below its opening (typo or replaced meter) and reports that day as missing', async () => {
    const { service: s } = service([row('2026-11-01', 100, 90), row('2026-11-02', 100, 100.5)]);
    await expect(one(s, '2026-11-01', '2026-11-02')).resolves.toEqual({ m3: 0.5, readingDays: 1, spanDays: 2 });
  });

  it('answers an empty range with zero and does not read anything', async () => {
    const { service: s, list } = service([]);
    await expect(one(s, '2026-11-05', '2026-11-04')).resolves.toEqual({ m3: 0, readingDays: 0, spanDays: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it('rounds away float noise', async () => {
    const { service: s } = service([row('2026-11-01', 0.1, 0.3), row('2026-11-02', 0.3, 0.6)]);
    await expect(one(s, '2026-11-01', '2026-11-02')).resolves.toMatchObject({ m3: 0.5 });
  });

  it('reads each depot once for all its ranges and sums each range on its own days', async () => {
    const { service: s, list } = service([row('2026-11-01', 0, 1), row('2026-11-02', 1, 3), row('2026-11-03', 3, 6)]);
    const out = await s.volumes([
      { depotId: D, from: '2026-11-01', to: '2026-11-03' },
      { depotId: D, from: '2026-11-03', to: '2026-11-03' },
      { depotId: D2, from: '2026-11-02', to: '2026-11-02' },
      { depotId: D2, from: '2026-11-05', to: '2026-11-04' },
    ]);
    expect(out.map((r) => r.m3)).toEqual([6, 3, 2, 0]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, D, '2026-11-01', '2026-11-03');
  });
});

describe('MeterVolumeController', () => {
  it('answers one item per range, in order', async () => {
    const volumes = jest.fn().mockResolvedValue([{ m3: 1, readingDays: 1, spanDays: 1 }]);
    const c = new MeterVolumeController({ volumes } as never);
    const body = { ranges: [{ depotId: D, from: '2026-11-01', to: '2026-11-01' }] };
    await expect(c.volume(body as never)).resolves.toEqual({ items: [{ m3: 1, readingDays: 1, spanDays: 1 }] });
    expect(volumes).toHaveBeenCalledWith(body.ranges);
  });

  it('validates the body: real days, 1..200 ranges', async () => {
    const ok = plainToInstance(MeterVolumeDto, { ranges: [{ depotId: D, from: '2026-11-01', to: '2026-11-30' }] });
    expect(await validate(ok)).toEqual([]);
    for (const bad of [
      { ranges: [] },
      { ranges: [{ depotId: D, from: '2026-13-01', to: '2026-11-30' }] },
      { ranges: [{ depotId: D, from: '2026-11-01T00:00:00Z', to: '2026-11-30' }] },
      { ranges: [{ depotId: 'x', from: '2026-11-01', to: '2026-11-30' }] },
      { ranges: Array.from({ length: 201 }, () => ({ depotId: D, from: '2026-11-01', to: '2026-11-02' })) },
    ]) {
      expect((await validate(plainToInstance(MeterVolumeDto, bad))).length).toBeGreaterThan(0);
    }
  });
});
