import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MeterService } from '../../src/application/services/meter.service';
import { MeterVolumeController } from '../../src/modules/meter-volume.controller';
import { MeterVolumeDto } from '../../src/modules/dto/meter-reading.dto';

/*
 * HD-15: the water through a depot's meter over a day range, for maintenance by volume. Only a
 * closed day counts; a day without a closing, or with closing below opening, is not a reading day.
 */
const D = '11111111-1111-4111-8111-111111111111';
const row = (date: string, openingM3: number, closingM3: number | null) => ({ date, openingM3, closingM3 });

function service(rows: ReturnType<typeof row>[]): { service: MeterService; list: jest.Mock } {
  const list = jest.fn(async () => rows);
  return {
    service: new MeterService({ listForRange: list } as never, {} as never, {} as never, {} as never),
    list,
  };
}

describe('MeterService.volume (HD-15)', () => {
  it('sums closing minus opening over the closed days and says how many days it rests on', async () => {
    const { service: s } = service([row('2026-11-01', 100, 101.25), row('2026-11-02', 101.25, 102), row('2026-11-03', 102, null)]);
    await expect(s.volume(D, '2026-11-01', '2026-11-04')).resolves.toEqual({ m3: 2, readingDays: 2, spanDays: 4 });
  });

  it('leaves out a closing below its opening (typo or replaced meter) and reports that day as missing', async () => {
    const { service: s } = service([row('2026-11-01', 100, 90), row('2026-11-02', 100, 100.5)]);
    await expect(s.volume(D, '2026-11-01', '2026-11-02')).resolves.toEqual({ m3: 0.5, readingDays: 1, spanDays: 2 });
  });

  it('answers an empty range with zero and does not read anything', async () => {
    const { service: s, list } = service([]);
    await expect(s.volume(D, '2026-11-05', '2026-11-04')).resolves.toEqual({ m3: 0, readingDays: 0, spanDays: 0 });
    expect(list).not.toHaveBeenCalled();
  });

  it('rounds away float noise', async () => {
    const { service: s } = service([row('2026-11-01', 0.1, 0.3), row('2026-11-02', 0.3, 0.6)]);
    await expect(s.volume(D, '2026-11-01', '2026-11-02')).resolves.toMatchObject({ m3: 0.5 });
  });
});

describe('MeterVolumeController', () => {
  it('answers one item per range, in order', async () => {
    const volume = jest.fn().mockResolvedValueOnce({ m3: 1, readingDays: 1, spanDays: 1 }).mockResolvedValueOnce({ m3: 0, readingDays: 0, spanDays: 0 });
    const c = new MeterVolumeController({ volume } as never);
    const body = { ranges: [{ depotId: D, from: '2026-11-01', to: '2026-11-01' }, { depotId: D, from: '2026-11-03', to: '2026-11-02' }] };
    await expect(c.volume(body as never)).resolves.toEqual({ items: [{ m3: 1, readingDays: 1, spanDays: 1 }, { m3: 0, readingDays: 0, spanDays: 0 }] });
    expect(volume).toHaveBeenNthCalledWith(2, D, '2026-11-03', '2026-11-02');
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
