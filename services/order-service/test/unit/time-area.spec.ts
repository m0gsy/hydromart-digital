import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CAPABILITY_KEY } from '@hydromart/platform';

import type { TimeAreaRaw } from '../../src/application/ports/order.repository';
import { ReportService } from '../../src/application/services/report.service';
import { OrderConfigService } from '../../src/config/order-config.service';
import { RecentActivityQueryDto, TimeAreaQueryDto } from '../../src/modules/dto/report.dto';
import { ReportController } from '../../src/modules/report.controller';

/**
 * When orders come in and where they go, and the feed of what was touched last. The shape is the
 * contract the dashboard draws from, so it never changes with the data: a heat grid is always
 * seven days of twenty-four hours.
 */
const config = (): OrderConfigService =>
  ({ businessTimeZone: 'Asia/Jakarta' }) as OrderConfigService;

const DEPOT_A = '11111111-1111-4111-8111-111111111111';
const DEPOT_B = '22222222-2222-4222-8222-222222222222';
const range = {
  from: new Date('2026-09-30T17:00:00.000Z'),
  to: new Date('2026-10-31T17:00:00.000Z'),
};

const withRaw = (raw: TimeAreaRaw) => {
  const timeArea = jest.fn(async () => raw);
  return { svc: new ReportService({ timeArea } as never, config()), timeArea };
};

describe('ReportService.timeArea', () => {
  it('lays the cells into a seven by twenty-four grid, Monday first', async () => {
    const { svc, timeArea } = withRaw({
      heat: [
        { weekday: 1, hour: 8, orders: 4, revenue: 400_000 },
        { weekday: 7, hour: 23, orders: 2, revenue: 150_000 },
        { weekday: 1, hour: 9, orders: 1, revenue: 50_000 },
      ],
      areas: [],
    });
    const out = await svc.timeArea(range, [DEPOT_A]);
    expect(out.heat).toHaveLength(7);
    expect(out.heat.every((row) => row.length === 24)).toBe(true);
    expect(out.heat[0]![8]).toBe(4);
    expect(out.heat[6]![23]).toBe(2);
    expect(out.byWeekday[0]).toEqual({ weekday: 0, orders: 5, revenue: 450_000 });
    expect(out.byWeekday[6]).toEqual({ weekday: 6, orders: 2, revenue: 150_000 });
    expect(out.orders).toBe(7);
    expect(out.revenue).toBe(600_000);
    // The zone and the scope reach the repository.
    expect(timeArea).toHaveBeenCalledWith(range, 'Asia/Jakarta', [DEPOT_A]);
  });

  it('answers an empty window with a full grid of zeros, not an empty one', async () => {
    const { svc } = withRaw({ heat: [], areas: [] });
    const out = await svc.timeArea(range);
    expect(out.heat.flat().every((n) => n === 0)).toBe(true);
    expect(out.byWeekday).toHaveLength(7);
    expect(out.orders).toBe(0);
    expect(out.byArea).toEqual([]);
    expect(out.otherAreas).toBeNull();
  });

  it('drops a cell the database could not have produced instead of writing outside the grid', async () => {
    const { svc } = withRaw({
      heat: [
        { weekday: 0, hour: 1, orders: 9, revenue: 9 },
        { weekday: 8, hour: 1, orders: 9, revenue: 9 },
        { weekday: 2, hour: 24, orders: 9, revenue: 9 },
        { weekday: 2, hour: -1, orders: 9, revenue: 9 },
      ],
      areas: [],
    });
    const out = await svc.timeArea(range);
    expect(out.orders).toBe(0);
  });

  it('keeps the ten busiest areas and folds the rest into one line', async () => {
    const areas = Array.from({ length: 13 }, (_, i) => ({
      area: `Kota ${i + 1}`,
      orders: 20 - i,
      revenue: (20 - i) * 1000,
    }));
    const { svc } = withRaw({ heat: [], areas });
    const out = await svc.timeArea(range);
    expect(out.byArea).toHaveLength(10);
    expect(out.byArea[0]!.area).toBe('Kota 1');
    // Orders 10 + 9 + 8 for the three left over.
    expect(out.otherAreas).toEqual({ areas: 3, orders: 27, revenue: 27_000 });
  });

  it('echoes the window it answered for', async () => {
    const { svc } = withRaw({ heat: [], areas: [] });
    const out = await svc.timeArea(range);
    expect(out.from).toBe(range.from.toISOString());
    expect(out.to).toBe(range.to.toISOString());
  });
});

describe('ReportService.recentActivity', () => {
  const row = {
    id: 'o-1',
    orderNumber: 'HM-20261015-000001',
    status: 'CONFIRMED',
    total: 50_000,
    isWalkIn: false,
    depotId: DEPOT_A,
    updatedAt: new Date('2026-10-15T05:00:00.000Z'),
  };

  it('returns the lines with the time as text, and nothing about the customer', async () => {
    const recentActivity = jest.fn(async () => [row]);
    const svc = new ReportService({ recentActivity } as never, config());
    const out = await svc.recentActivity(20, [DEPOT_A]);
    expect(out.items).toEqual([{ ...row, updatedAt: '2026-10-15T05:00:00.000Z' }]);
    expect(Object.keys(out.items[0]!).sort()).toEqual(
      ['depotId', 'id', 'isWalkIn', 'orderNumber', 'status', 'total', 'updatedAt'].sort(),
    );
    expect(recentActivity).toHaveBeenCalledWith(20, [DEPOT_A]);
  });

  it('keeps the page between 1 and 50 lines whatever it is asked for', async () => {
    const recentActivity = jest.fn(
      async (_limit: number, _depotIds?: readonly string[]) => [] as never[],
    );
    const svc = new ReportService({ recentActivity } as never, config());
    await svc.recentActivity(0);
    await svc.recentActivity(9999);
    await svc.recentActivity(7.9);
    expect(recentActivity.mock.calls.map((c) => c[0])).toEqual([1, 50, 7]);
  });
});

describe('ReportController time-area and recent-activity', () => {
  const user = (over: Record<string, unknown>) => ({ sub: 'u-1', phone: '0811', ...over }) as never;
  const query = { from: range.from.toISOString(), to: range.to.toISOString() } as TimeAreaQueryDto;
  let service: { timeArea: jest.Mock; recentActivity: jest.Mock };
  let controller: ReportController;

  beforeEach(() => {
    service = {
      timeArea: jest.fn().mockResolvedValue('grid'),
      recentActivity: jest.fn().mockResolvedValue('feed'),
    };
    controller = new ReportController(service as unknown as ReportService, {} as never);
  });

  it('hands head office the network and a manager only their depots', async () => {
    await expect(controller.timeArea(query, user({ role: 'HEAD_OFFICE' }))).resolves.toBe('grid');
    expect(service.timeArea).toHaveBeenCalledWith(range, undefined);
    await controller.timeArea(
      query,
      user({ role: 'MANAGER', depotId: DEPOT_A, depotIds: [DEPOT_A, DEPOT_B] }),
    );
    expect(service.timeArea).toHaveBeenLastCalledWith(range, [DEPOT_A, DEPOT_B]);
  });

  it('refuses a scoped account with no depot, for both reads', () => {
    const none = user({ role: 'MANAGER', depotId: null, depotIds: [] });
    expect(() => controller.timeArea(query, none)).toThrow();
    expect(() => controller.recentActivity({} as RecentActivityQueryDto, none)).toThrow();
    expect(service.timeArea).not.toHaveBeenCalled();
    expect(service.recentActivity).not.toHaveBeenCalled();
  });

  it('defaults the feed to twenty lines and narrows it like the other reads', async () => {
    await controller.recentActivity(
      {} as RecentActivityQueryDto,
      user({ role: 'MANAGER', depotId: DEPOT_A, depotIds: [DEPOT_A] }),
    );
    expect(service.recentActivity).toHaveBeenCalledWith(20, [DEPOT_A]);
    await controller.recentActivity(
      { limit: 5, depotIds: DEPOT_B } as RecentActivityQueryDto,
      user({ role: 'HEAD_OFFICE' }),
    );
    expect(service.recentActivity).toHaveBeenLastCalledWith(5, [DEPOT_B]);
  });

  it('sits behind the report capability', () => {
    expect(Reflect.getMetadata(CAPABILITY_KEY, ReportController)).toBe('orderReports');
  });
});

describe('the query DTOs', () => {
  const from = '2026-09-30T17:00:00.000Z';
  const to = '2026-10-31T17:00:00.000Z';

  it('time-area needs both bounds, like the status summary', async () => {
    const run = (plain: Record<string, unknown>) =>
      validate(plainToInstance(TimeAreaQueryDto, plain));
    expect(await run({ from, to })).toEqual([]);
    expect((await run({ from })).map((e) => e.property)).toContain('to');
    expect((await run({ from, to, depotIds: 'nope' })).map((e) => e.property)).toContain(
      'depotIds',
    );
  });

  it('the feed accepts 1..50 lines and a clean depot list, and nothing else', async () => {
    const run = (plain: Record<string, unknown>) =>
      validate(plainToInstance(RecentActivityQueryDto, plain));
    expect(await run({})).toEqual([]);
    expect(await run({ limit: '50', depotIds: `${DEPOT_A},${DEPOT_B}` })).toEqual([]);
    expect((await run({ limit: '0' })).map((e) => e.property)).toContain('limit');
    expect((await run({ limit: '51' })).map((e) => e.property)).toContain('limit');
    expect((await run({ limit: '1.5' })).map((e) => e.property)).toContain('limit');
    expect((await run({ depotIds: 'x' })).map((e) => e.property)).toContain('depotIds');
  });
});
