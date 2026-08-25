import { OrderRecord, OrderRepository } from '../../src/application/ports/order.repository';
import { ReportService } from '../../src/application/services/report.service';
import { OrderStatus } from '../../src/domain/order-status';
import { localMonthKey } from '@hydromart/platform';
import { OrderConfigService } from '../../src/config/order-config.service';
/**
 * The service reads only `businessTimeZone` off the config. WIB is pinned here on
 * purpose: every day/month boundary in these reports used to be built from UTC (H-16),
 * and a test that inherits the host's zone cannot catch that coming back.
 */
const reportTestConfig = (timeZone = 'Asia/Jakarta'): OrderConfigService =>
  ({ businessTimeZone: timeZone }) as OrderConfigService;


interface OrderOverrides {
  customerId: string;
  createdAt: string;
  qty?: number;
  id?: string;
  status?: OrderStatus;
}

function order(over: OrderOverrides): OrderRecord {
  return {
    id: over.id ?? 'o',
    customerId: over.customerId,
    status: over.status ?? OrderStatus.DELIVERED,
    total: 0,
    driverName: null,
    items: [
      {
        productName: 'Galon 19L',
        unit: 'galon',
        volumeMl: 19000,
        isGallon: true,
        quantity: over.qty ?? 0,
      },
    ],
    createdAt: new Date(over.createdAt),
  } as unknown as OrderRecord;
}

describe('ReportService.resellerRollup', () => {
  it('sums gallons this month and previous month per reseller, with order count + last order', async () => {
    /*
     * J12: attainment is read by CUSTOMER now, not by depot — an agen's gallons count
     * wherever they were fulfilled, because the target is theirs. `ordersForDepot` is still
     * read, for the home depot's own share. Here every order is at the home depot, so the
     * two agree and this test keeps asserting exactly what it always did.
     */
    const window = jest.fn(async (range: { from: Date; to: Date }) => {
        // The window is reckoned in WIB (H-16), so July starts at 2026-06-30T17:00Z —
        // `getUTCMonth()` on the boundary instant reads June and picked the wrong list.
        const isJuly = localMonthKey(range.from) === '2026-07';
        if (isJuly) {
          return [
            order({ customerId: 'r1', qty: 5, createdAt: '2026-07-03T00:00:00Z', id: 'a' }),
            order({ customerId: 'r1', qty: 7, createdAt: '2026-07-20T00:00:00Z', id: 'b' }),
            order({ customerId: 'other', qty: 99, createdAt: '2026-07-10T00:00:00Z' }),
            order({
              customerId: 'r1',
              qty: 3,
              createdAt: '2026-07-15T00:00:00Z',
              status: OrderStatus.CANCELLED,
            }),
          ];
        }
        // June (previous month)
        return [order({ customerId: 'r1', qty: 4, createdAt: '2026-06-10T00:00:00Z' })];
    });
    const repo = {
      ordersForCustomers: jest.fn(async (_ids: string[], range: { from: Date; to: Date }) =>
        window(range),
      ),
      ordersForDepot: jest.fn(async (_depotId: string, range: { from: Date; to: Date }) =>
        window(range),
      ),
    };
    const svc = new ReportService(repo as unknown as OrderRepository, reportTestConfig());

    const out = await svc.resellerRollup('d1', '2026-07', ['r1']);

    expect(out.rows).toHaveLength(1);
    const r = out.rows[0];
    expect(r.customerId).toBe('r1');
    expect(r.volumeQty).toBe(12); // 5 + 7, cancelled 3 excluded
    // Every one of those was at the home depot, so the share equals the total.
    expect(r.volumeAtDepotQty).toBe(12);
    expect(r.prevVolumeQty).toBe(4);
    expect(r.orderCount).toBe(2);
    expect(r.lastOrderAt).toBe('2026-07-20T00:00:00.000Z');
  });

  it('returns no rows when customerIds is empty', async () => {
    const repo = { ordersForDepot: jest.fn(), ordersForCustomers: jest.fn() };
    const svc = new ReportService(repo as unknown as OrderRepository, reportTestConfig());
    const out = await svc.resellerRollup('d1', '2026-07', []);
    expect(out.rows).toEqual([]);
    expect(repo.ordersForDepot).not.toHaveBeenCalled();
    expect(repo.ordersForCustomers).not.toHaveBeenCalled();
  });
});
