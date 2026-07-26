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
    resellerRollup: jest.fn().mockResolvedValue('rollup'),
    customerSummary: jest.fn().mockResolvedValue('customer'),
  } as unknown as Mocked;
}

describe('ReportController', () => {
  let service: Mocked;
  let controller: ReportController;

  beforeEach(() => {
    service = makeService();
    controller = new ReportController(service as unknown as ReportService);
  });

  it('sales: defaults granularity to daily and parses an empty range to undefined bounds', async () => {
    await expect(controller.sales({} as never)).resolves.toBe('sales');
    expect(service.sales).toHaveBeenCalledWith('daily', { from: undefined, to: undefined });
  });

  it('sales: forwards explicit granularity and parses from/to into Dates', async () => {
    await controller.sales({ granularity: 'monthly', from: '2026-01-01', to: '2026-02-01' } as never);
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
    expect(date).toBe(new Date().toISOString().slice(0, 10));
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
    await expect(controller.depotCompare({ depotIds: 'd1, d2 ,,d3' } as never)).resolves.toBe('compare');
    expect(service.reportsDepotCompare).toHaveBeenCalledWith(['d1', 'd2', 'd3'], {
      from: undefined,
      to: undefined,
    });
  });

  it('depotMonthly: forwards depotId and month', async () => {
    await expect(controller.depotMonthly({ depotId: 'd1', month: '2026-02' } as never)).resolves.toBe(
      'monthly',
    );
    expect(service.reportsDepotMonthly).toHaveBeenCalledWith('d1', '2026-02');
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

  it('resellerRollup: splits the customerIds CSV and forwards depot + month', async () => {
    await expect(
      controller.resellerRollup({ depotId: 'd1', month: '2026-02', customerIds: 'c1 ,c2' } as never),
    ).resolves.toBe('rollup');
    expect(service.resellerRollup).toHaveBeenCalledWith('d1', '2026-02', ['c1', 'c2']);
  });

  it('customer: forwards the path customerId to the 360 summary', async () => {
    await expect(controller.customer('c9')).resolves.toBe('customer');
    expect(service.customerSummary).toHaveBeenCalledWith('c9');
  });
});
