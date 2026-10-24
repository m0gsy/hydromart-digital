import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CAPABILITY_KEY } from '@hydromart/platform';

import { ReportService } from '../../src/application/services/report.service';
import { ReportController } from '../../src/modules/report.controller';
import { StatusSummaryQueryDto } from '../../src/modules/dto/report.dto';
import { OrderConfigService } from '../../src/config/order-config.service';
import type { StatusSummaryRaw } from '../../src/application/ports/order.repository';

/**
 * The insight dashboard's order-health numbers: counts by status for a window, the channel
 * and refund splits, and what is in flight right now. The definitions are the contract, so
 * each is pinned here rather than left to whoever reads the code next.
 */
const config = (): OrderConfigService =>
  ({ businessTimeZone: 'Asia/Jakarta' }) as OrderConfigService;

const DEPOT_A = '11111111-1111-4111-8111-111111111111';
const DEPOT_B = '22222222-2222-4222-8222-222222222222';

const raw = (over: Partial<StatusSummaryRaw> = {}): StatusSummaryRaw => ({
  window: {
    byStatus: [
      { status: 'COMPLETED', count: 6, revenue: 600_000 },
      { status: 'ON_DELIVERY', count: 2, revenue: 200_000 },
      { status: 'CANCELLED', count: 2, revenue: 150_000 },
      { status: 'VOIDED', count: 1, revenue: 40_000 },
    ],
    channel: { walkIn: 3, app: 5 },
    refunds: { orders: 2, amount: 30_000 },
  },
  live: {
    byStatus: [
      { status: 'CONFIRMED', count: 2 },
      { status: 'PREPARING', count: 1 },
      { status: 'ON_DELIVERY', count: 4 },
    ],
  },
  ...over,
});

const serviceWith = (value: StatusSummaryRaw) => {
  const statusSummary = jest.fn(async () => value);
  const svc = new ReportService({ statusSummary } as never, config());
  return { svc, statusSummary };
};

const range = {
  from: new Date('2026-09-30T17:00:00.000Z'),
  to: new Date('2026-10-31T17:00:00.000Z'),
};

describe('ReportService.statusSummary', () => {
  it('counts sales as every order that is neither cancelled nor voided', async () => {
    const { svc } = serviceWith(raw());
    const { window } = await svc.statusSummary(range);
    // 6 completed + 2 on delivery; the 2 cancelled and 1 voided are not sales.
    expect(window.orders).toBe(8);
    expect(window.revenue).toBe(800_000);
    expect(window.aov).toBe(100_000);
    expect(window.cancelled).toBe(2);
    expect(window.voided).toBe(1);
    expect(window.completed).toBe(6);
  });

  it('rates cancellations against the orders that were placed, voids left out', async () => {
    const { svc } = serviceWith(raw());
    const { window } = await svc.statusSummary(range);
    // 2 cancelled of 10 placed (8 sales + 2 cancelled). The void was undone at the till.
    expect(window.cancelRate).toBeCloseTo(0.2, 10);
    // 2 refunded of 8 sales.
    expect(window.refundedOrders).toBe(2);
    expect(window.refundedAmount).toBe(30_000);
    expect(window.refundRate).toBeCloseTo(0.25, 10);
  });

  it('splits the sales by channel', async () => {
    const { svc } = serviceWith(raw());
    const { window } = await svc.statusSummary(range);
    expect(window.walkIn).toBe(3);
    expect(window.app).toBe(5);
  });

  it('reports every status, zero when absent, so the shape never changes', async () => {
    const { svc } = serviceWith(raw());
    const { window } = await svc.statusSummary(range);
    expect(Object.keys(window.byStatus).sort()).toEqual(
      [
        'CANCELLED',
        'COMPLETED',
        'CONFIRMED',
        'CREATED',
        'DELIVERED',
        'DRIVER_ASSIGNED',
        'ON_DELIVERY',
        'PICKED_UP',
        'PREPARING',
        'VOIDED',
      ].sort(),
    );
    expect(window.byStatus.COMPLETED).toBe(6);
    expect(window.byStatus.CREATED).toBe(0);
  });

  it('answers null, never NaN or 0, when there is nothing to divide by', async () => {
    const { svc } = serviceWith(
      raw({
        window: {
          byStatus: [],
          channel: { walkIn: 0, app: 0 },
          refunds: { orders: 0, amount: 0 },
        },
      }),
    );
    const { window } = await svc.statusSummary(range);
    expect(window.orders).toBe(0);
    expect(window.revenue).toBe(0);
    expect(window.aov).toBeNull();
    expect(window.cancelRate).toBeNull();
    expect(window.refundRate).toBeNull();
  });

  it('still rates a window that holds only cancelled orders', async () => {
    const { svc } = serviceWith(
      raw({
        window: {
          byStatus: [{ status: 'CANCELLED', count: 3, revenue: 90_000 }],
          channel: { walkIn: 0, app: 0 },
          refunds: { orders: 0, amount: 0 },
        },
      }),
    );
    const { window } = await svc.statusSummary(range);
    expect(window.orders).toBe(0);
    expect(window.cancelRate).toBe(1);
    expect(window.refundRate).toBeNull();
  });

  it('reports what is in flight now, and which of it still needs a courier', async () => {
    const { svc } = serviceWith(raw());
    const { live } = await svc.statusSummary(range);
    expect(live.inProgress).toBe(7);
    // CONFIRMED + PREPARING: accepted but no courier yet.
    expect(live.unrouted).toBe(3);
    expect(live.byStatus.ON_DELIVERY).toBe(4);
    expect(live.byStatus.CREATED).toBe(0);
    // A delivered or finished order is not in flight, so the live map has no key for it.
    expect(live.byStatus).not.toHaveProperty('COMPLETED');
    expect(live.byStatus).not.toHaveProperty('DELIVERED');
  });

  it('echoes the window and hands the depot scope to the repository', async () => {
    const { svc, statusSummary } = serviceWith(raw());
    const out = await svc.statusSummary(range, [DEPOT_A, DEPOT_B]);
    expect(out.from).toBe(range.from.toISOString());
    expect(out.to).toBe(range.to.toISOString());
    expect(statusSummary).toHaveBeenCalledWith(range, [DEPOT_A, DEPOT_B]);
  });
});

describe('ReportController.statusSummary', () => {
  const user = (over: Record<string, unknown>) => ({ sub: 'u-1', phone: '0811', ...over }) as never;
  const query = {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  } as StatusSummaryQueryDto;
  let service: { statusSummary: jest.Mock };
  let controller: ReportController;

  beforeEach(() => {
    service = { statusSummary: jest.fn().mockResolvedValue('summary') };
    controller = new ReportController(service as unknown as ReportService);
  });

  it('hands head office the whole network', async () => {
    await expect(controller.statusSummary(query, user({ role: 'HEAD_OFFICE' }))).resolves.toBe(
      'summary',
    );
    expect(service.statusSummary).toHaveBeenCalledWith(range, undefined);
  });

  it("narrows a manager to the depots they are responsible for — not the network's", async () => {
    await controller.statusSummary(
      query,
      user({ role: 'MANAGER', depotId: DEPOT_A, depotIds: [DEPOT_A, DEPOT_B] }),
    );
    expect(service.statusSummary).toHaveBeenCalledWith(range, [DEPOT_A, DEPOT_B]);
  });

  it('honours an explicit depotIds list (the guard has already vetted it)', async () => {
    await controller.statusSummary(
      { ...query, depotIds: `${DEPOT_A}, ${DEPOT_B}` } as StatusSummaryQueryDto,
      user({ role: 'HEAD_OFFICE' }),
    );
    expect(service.statusSummary).toHaveBeenCalledWith(range, [DEPOT_A, DEPOT_B]);
  });

  it('refuses a scoped account that is responsible for no depot at all', () => {
    expect(() =>
      controller.statusSummary(query, user({ role: 'MANAGER', depotId: null, depotIds: [] })),
    ).toThrow();
    expect(service.statusSummary).not.toHaveBeenCalled();
  });

  it('is gated by the report capability like every sibling on this controller', () => {
    expect(Reflect.getMetadata(CAPABILITY_KEY, ReportController)).toBe('orderReports');
  });
});

describe('StatusSummaryQueryDto', () => {
  const run = (plain: Record<string, unknown>) =>
    validate(plainToInstance(StatusSummaryQueryDto, plain));
  const from = '2026-09-30T17:00:00.000Z';
  const to = '2026-10-31T17:00:00.000Z';

  it('accepts a bounded window', async () => {
    expect(await run({ from, to })).toEqual([]);
    expect(await run({ from, to, depotIds: `${DEPOT_A},${DEPOT_B}` })).toEqual([]);
  });

  it('requires both bounds: an open-ended status summary is a scan of the whole table', async () => {
    expect((await run({ from })).map((e) => e.property)).toContain('to');
    expect((await run({ to })).map((e) => e.property)).toContain('from');
    expect((await run({})).length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a reversed or over-long window', async () => {
    expect((await run({ from: to, to: from })).map((e) => e.property)).toContain('to');
    expect(
      (await run({ from: '2024-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' })).map(
        (e) => e.property,
      ),
    ).toContain('to');
  });

  it('refuses a malformed date', async () => {
    expect((await run({ from: 'yesterday', to })).map((e) => e.property)).toContain('from');
  });
});
