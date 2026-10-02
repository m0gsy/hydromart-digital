import { randomUUID } from 'node:crypto';

import { PaymentService } from '../../src/application/services/payment.service';
import { PaymentMethod } from '../../src/domain/payment';
import {
  FakeGateway,
  FakeOrderCoordination,
  InMemoryPaymentRepository,
  buildTestConfig,
} from '../support/fakes';

// Owner decision, 2026-10-02: imported pre-Hydromart history counts toward revenue-by-
// method too, merged against order-service's ALREADY-NORMALISED labels (see
// normalizeMethod in order-service) — this suite only has to prove the merge, not the
// normalisation, which is why FakeOrderCoordination hands back clean CASH/QRIS/'OTHER'.
describe('PaymentService.revenueByMethod — historical merge', () => {
  let repo: InMemoryPaymentRepository;
  let orders: FakeOrderCoordination;
  let service: PaymentService;
  const customer = randomUUID();

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    orders = new FakeOrderCoordination();
    orders.orderCustomerId = customer;
    service = new PaymentService(repo, new FakeGateway(), orders, buildTestConfig());
  });

  const initiate = (method: PaymentMethod, amount: number) =>
    service.initiate(customer, { orderId: randomUUID(), method, amount });

  it('sums into the same live method row rather than duplicating it', async () => {
    const paid = await initiate(PaymentMethod.CASH, 10_000);
    await service.confirm(paid.id, 'staff');

    orders.historicalByMethod = [{ method: 'CASH', orders: 3, revenue: 60_000 }];

    const rows = await service.revenueByMethod({});
    const byMethod = Object.fromEntries(rows.map((r) => [r.method, r]));
    expect(byMethod[PaymentMethod.CASH]).toMatchObject({ amount: 70_000, count: 4 });
  });

  it("adds a method with no live activity as its own row, including 'OTHER'", async () => {
    orders.historicalByMethod = [{ method: 'OTHER', orders: 2, revenue: 15_000 }];

    const rows = await service.revenueByMethod({});
    expect(rows).toEqual([{ method: 'OTHER', amount: 15_000, count: 2 }]);
  });

  it('leaves live totals untouched when order-service has nothing (or is unreachable)', async () => {
    const paid = await initiate(PaymentMethod.QRIS, 25_000);
    await service.confirm(paid.id, 'staff');
    orders.historicalByMethod = [];

    const rows = await service.revenueByMethod({});
    expect(rows).toEqual([{ method: PaymentMethod.QRIS, amount: 25_000, count: 1 }]);
  });
});
