import { BadRequestException } from '@nestjs/common';

import { ReportController } from '../../src/modules/report.controller';
import { ReportService } from '../../src/application/services/report.service';

// Each handler is a thin delegate: it maps the query DTO to service args (applying
// toRange / default limit / default granularity branches) and returns the service's value.
// We mock the service and assert both the delegation args and the returned value.

type Mocked = { [K in keyof ReportService]: jest.Mock };

function makeService(): Mocked {
  return {
    sales: jest.fn().mockResolvedValue('sales'),
    topCustomers: jest.fn().mockResolvedValue('topCustomers'),
    topDepots: jest.fn().mockResolvedValue('topDepots'),
    shippingByDepot: jest.fn().mockResolvedValue('shipping'),
    refundsByDepot: jest.fn().mockResolvedValue('refunds'),
    ratingByDepot: jest.fn().mockResolvedValue('rating'),
    depotRatings: jest.fn().mockResolvedValue('depotRatings'),
    revenueByProduct: jest.fn().mockResolvedValue('revenue'),
    retentionCohort: jest.fn().mockResolvedValue('retention'),
    depotDaily: jest.fn().mockResolvedValue('daily'),
    depotWeekly: jest.fn().mockResolvedValue('weekly'),
    reportsDepotCompare: jest.fn().mockResolvedValue('compare'),
    reportsDepotMonthly: jest.fn().mockResolvedValue('monthly'),
    audienceReach: jest.fn().mockResolvedValue('reach'),
    segmentEstimate: jest.fn().mockResolvedValue('segment'),
    segmentCustomers: jest.fn().mockResolvedValue({ customerIds: ['c1'], truncated: false }),
    exportRows: jest.fn().mockResolvedValue([{ label: 'Depot A', orders: 2, revenue: 5000 }]),
    resellerRollup: jest.fn().mockResolvedValue('rollup'),
    customerSummary: jest.fn().mockResolvedValue('customer'),
    depotDailyRows: jest.fn().mockResolvedValue('dailyRows'),
    depotDailyGallons: jest.fn().mockResolvedValue([]),
    broadcastDailySales: jest.fn().mockResolvedValue({ attempted: 2, skipped: 0 }),
  } as unknown as Mocked;
}

const DEPOT_A = '11111111-1111-4111-8111-111111111111';
const DEPOT_B = '22222222-2222-4222-8222-222222222222';
const kepalaDepot = (depotId: string) =>
  ({ sub: 'kd-1', role: 'KEPALA_DEPOT', phone: '0811', depotId }) as never;
const headOffice = () => ({ sub: 'hq-1', role: 'HEAD_OFFICE', phone: '0822' }) as never;

describe('ReportController', () => {
  let service: Mocked;
  let controller: ReportController;

  beforeEach(() => {
    service = makeService();
    controller = new ReportController(service as unknown as ReportService);
  });

  /*
   * B-8. `depotId` comes from the client and DEPOT_REPORT_ROLES includes KEPALA_DEPOT, so
   * without a check against the CALLER any depot head could export another depot's day —
   * and unlike the aggregate report next to it, this route returns every customer's name
   * and every courier's name, row by row.
   */
  describe('depot-daily/export depot scope', () => {
    it('lets a depot head export their own day', async () => {
      await expect(
        controller.depotDailyExport({ depotId: DEPOT_A } as never, kepalaDepot(DEPOT_A)),
      ).resolves.toBe('dailyRows');
      expect(service.depotDailyRows).toHaveBeenCalledWith(DEPOT_A, undefined);
    });

    it("refuses a depot head asking for another depot's named rows", () => {
      expect(() =>
        controller.depotDailyExport({ depotId: DEPOT_B } as never, kepalaDepot(DEPOT_A)),
      ).toThrow();
      expect(service.depotDailyRows).not.toHaveBeenCalled();
    });

    it('leaves head office able to export any depot', async () => {
      await expect(
        controller.depotDailyExport({ depotId: DEPOT_B, date: '2026-08-04' } as never, headOffice()),
      ).resolves.toBe('dailyRows');
      expect(service.depotDailyRows).toHaveBeenCalledWith(DEPOT_B, '2026-08-04');
    });
  });

  it('sales: defaults granularity to daily and parses an empty range to undefined bounds', async () => {
    await expect(controller.sales({} as never)).resolves.toBe('sales');
    expect(service.sales).toHaveBeenCalledWith('daily', { from: undefined, to: undefined });
  });

  it('sales: forwards explicit granularity and parses from/to into Dates', async () => {
    await controller.sales({
      granularity: 'monthly',
      from: '2026-01-01',
      to: '2026-02-01',
    } as never);
    const [granularity, range] = service.sales.mock.calls[0];
    expect(granularity).toBe('monthly');
    expect(range.from).toBeInstanceOf(Date);
    expect(range.to).toBeInstanceOf(Date);
    expect(range.from.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('topCustomers: defaults limit to 10, then honours an explicit limit', async () => {
    await expect(controller.topCustomers({} as never)).resolves.toBe('topCustomers');
    expect(service.topCustomers).toHaveBeenCalledWith({ from: undefined, to: undefined }, 10);
    await controller.topCustomers({ limit: 5 } as never);
    expect(service.topCustomers).toHaveBeenLastCalledWith(expect.anything(), 5);
  });

  it('topDepots: defaults limit to 10', async () => {
    await expect(controller.topDepots({} as never)).resolves.toBe('topDepots');
    expect(service.topDepots).toHaveBeenCalledWith({ from: undefined, to: undefined }, 10);
  });

  it('shippingByDepot / refundsByDepot / ratingByDepot: delegate with the parsed range', async () => {
    await expect(controller.shippingByDepot({} as never)).resolves.toBe('shipping');
    await expect(controller.refundsByDepot({} as never)).resolves.toBe('refunds');
    await expect(controller.ratingByDepot({} as never)).resolves.toBe('rating');
    expect(service.shippingByDepot).toHaveBeenCalledWith({ from: undefined, to: undefined });
    expect(service.refundsByDepot).toHaveBeenCalledWith({ from: undefined, to: undefined });
    expect(service.ratingByDepot).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });

  it('depotRatings: forwards depotId and range', async () => {
    await expect(controller.depotRatings({ depotId: 'd1' } as never)).resolves.toBe('depotRatings');
    expect(service.depotRatings).toHaveBeenCalledWith('d1', { from: undefined, to: undefined });
  });

  it('revenueByCategory: delegates to revenueByProduct with default limit 10', async () => {
    await expect(controller.revenueByCategory({} as never)).resolves.toBe('revenue');
    expect(service.revenueByProduct).toHaveBeenCalledWith({ from: undefined, to: undefined }, 10);
  });

  it('retentionCohort: delegates with the parsed range', async () => {
    await expect(controller.retentionCohort({} as never)).resolves.toBe('retention');
    expect(service.retentionCohort).toHaveBeenCalledWith({ from: undefined, to: undefined });
  });

  it('depotDaily: uses today when no date is supplied, else the given date', async () => {
    await controller.depotDaily({ depotId: 'd1' } as never);
    const [depotId, date] = service.depotDaily.mock.calls[0];
    expect(depotId).toBe('d1');
    // The default moved into the service (H-16): "today" has to be the WIB today, and
    // only the service knows the configured zone. The controller passes the gap through.
    expect(date).toBeUndefined();
    await controller.depotDaily({ depotId: 'd1', date: '2026-03-03' } as never);
    expect(service.depotDaily).toHaveBeenLastCalledWith('d1', '2026-03-03');
  });

  it('depotWeekly: parses optional from/to into Dates (undefined when absent)', async () => {
    await controller.depotWeekly({ depotId: 'd1' } as never);
    expect(service.depotWeekly).toHaveBeenCalledWith('d1', undefined, undefined);
    await controller.depotWeekly({ depotId: 'd1', from: '2026-01-01', to: '2026-01-08' } as never);
    const [, from, to] = service.depotWeekly.mock.calls[1];
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
  });

  it('depotCompare: splits, trims and drops blanks from the depotIds CSV', async () => {
    await expect(controller.depotCompare({ depotIds: 'd1, d2 ,,d3' } as never)).resolves.toBe(
      'compare',
    );
    expect(service.reportsDepotCompare).toHaveBeenCalledWith(['d1', 'd2', 'd3'], {
      from: undefined,
      to: undefined,
    });
  });

  it('depotMonthly: forwards depotId and month', async () => {
    await expect(
      controller.depotMonthly({ depotId: 'd1', month: '2026-02' } as never),
    ).resolves.toBe('monthly');
    expect(service.reportsDepotMonthly).toHaveBeenCalledWith('d1', '2026-02');
  });

  it('internalDepotDailyGallons: forwards the day keys and echoes the depotId', async () => {
    service.depotDailyGallons.mockResolvedValue([{ day: '2026-07-01', gallons: 130 }]);
    await expect(
      controller.internalDepotDailyGallons({
        depotId: 'd1',
        from: '2026-07-01',
        to: '2026-07-31',
      } as never),
    ).resolves.toEqual({ depotId: 'd1', days: [{ day: '2026-07-01', gallons: 130 }] });
    expect(service.depotDailyGallons).toHaveBeenCalledWith('d1', '2026-07-01', '2026-07-31');
  });

  it('internalDailySalesBroadcast: forwards the slot from the path', async () => {
    await expect(controller.internalDailySalesBroadcast('sore')).resolves.toEqual({
      attempted: 2,
      skipped: 0,
    });
    expect(service.broadcastDailySales).toHaveBeenCalledWith('sore');
  });

  it('internalDailySalesBroadcast: rejects a slot that is not siang or sore', () => {
    expect(() => controller.internalDailySalesBroadcast('malam')).toThrow(BadRequestException);
    expect(service.broadcastDailySales).not.toHaveBeenCalled();
  });

  it('audienceReach: forwards the depotId', async () => {
    await expect(controller.audienceReach({ depotId: 'd1' } as never)).resolves.toBe('reach');
    expect(service.audienceReach).toHaveBeenCalledWith('d1');
  });

  it('segmentEstimate: passes the whole query through', async () => {
    const q = { depotId: 'd1', recencyDays: 30 } as never;
    await expect(controller.segmentEstimate(q)).resolves.toBe('segment');
    expect(service.segmentEstimate).toHaveBeenCalledWith(q);
  });

  // Same query DTO as the estimate on purpose: crm sizes the audience with one route and
  // resolves it with the other, so a condition either reaches both or neither.
  it('internalSegmentCustomers: passes the same query the estimate takes', async () => {
    const q = { depotId: 'd1', lapsedDays: 60 } as never;
    await expect(controller.internalSegmentCustomers(q)).resolves.toEqual({
      customerIds: ['c1'],
      truncated: false,
    });
    expect(service.segmentCustomers).toHaveBeenCalledWith(q);
  });

  it('internalExportRows: wraps the rows and forwards the window', async () => {
    const q = { dataset: 'REVENUE_BY_DEPOT', from: '2026-08-01T00:00:00.000Z' } as never;
    await expect(controller.internalExportRows(q)).resolves.toEqual({
      rows: [{ label: 'Depot A', orders: 2, revenue: 5000 }],
    });
    expect(service.exportRows).toHaveBeenCalledWith('REVENUE_BY_DEPOT', {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: undefined,
    });
  });

  it('resellerRollup: splits the customerIds CSV and forwards depot + month', async () => {
    await expect(
      controller.resellerRollup({
        depotId: 'd1',
        month: '2026-02',
        customerIds: 'c1 ,c2',
      } as never),
    ).resolves.toBe('rollup');
    expect(service.resellerRollup).toHaveBeenCalledWith('d1', '2026-02', ['c1', 'c2']);
  });

  it('customer: forwards the path customerId to the 360 summary', async () => {
    await expect(controller.customer('c9')).resolves.toBe('customer');
    expect(service.customerSummary).toHaveBeenCalledWith('c9');
  });
});
