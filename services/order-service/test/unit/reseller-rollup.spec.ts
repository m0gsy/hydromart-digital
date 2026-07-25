import { ReportService } from '../../src/application/services/report.service';
import { OrderStatus } from '../../src/domain/order-status';

function order(over: any) {
  return {
    id: over.id ?? 'o',
    customerId: over.customerId,
    status: over.status ?? OrderStatus.DELIVERED,
    total: 0,
    driverName: null,
    items: [{ productName: 'Galon 19L', unit: 'galon', quantity: over.qty ?? 0 }],
    ...over,
    createdAt: new Date(over.createdAt),
  };
}

describe('ReportService.resellerRollup', () => {
  it('sums gallons this month and previous month per reseller, with order count + last order', async () => {
    const repo: any = {
      ordersForDepot: jest.fn(async (_depotId: string, range: { from: Date; to: Date }) => {
        const isJuly = range.from.getUTCMonth() === 6; // 0-based: July = 6
        if (isJuly) {
          return [
            order({ customerId: 'r1', qty: 5, createdAt: '2026-07-03T00:00:00Z', id: 'a' }),
            order({ customerId: 'r1', qty: 7, createdAt: '2026-07-20T00:00:00Z', id: 'b' }),
            order({ customerId: 'other', qty: 99, createdAt: '2026-07-10T00:00:00Z' }),
            order({ customerId: 'r1', qty: 3, createdAt: '2026-07-15T00:00:00Z', status: OrderStatus.CANCELLED }),
          ];
        }
        // June (previous month)
        return [order({ customerId: 'r1', qty: 4, createdAt: '2026-06-10T00:00:00Z' })];
      }),
    };
    const svc = new ReportService(repo);

    const out = await svc.resellerRollup('d1', '2026-07', ['r1']);

    expect(out.rows).toHaveLength(1);
    const r = out.rows[0];
    expect(r.customerId).toBe('r1');
    expect(r.volumeQty).toBe(12); // 5 + 7, cancelled 3 excluded
    expect(r.prevVolumeQty).toBe(4);
    expect(r.orderCount).toBe(2);
    expect(r.lastOrderAt).toBe('2026-07-20T00:00:00.000Z');
  });

  it('returns no rows when customerIds is empty', async () => {
    const repo: any = { ordersForDepot: jest.fn() };
    const svc = new ReportService(repo);
    const out = await svc.resellerRollup('d1', '2026-07', []);
    expect(out.rows).toEqual([]);
    expect(repo.ordersForDepot).not.toHaveBeenCalled();
  });
});
