import { randomUUID } from 'node:crypto';

import { AuthenticatedUser } from '@hydromart/platform';

import { OrderService } from '../../src/application/services/order.service';
import { OutboxService } from '../../src/application/services/outbox.service';
import {
  FakeCashierShift,
  FakeCustomerDirectory,
  FakeDepotDirectory,
  FakeDepotPricing,
  FakeForecastCoordination,
  FakeFranchiseRevenue,
  FakeInventory,
  FakeLoyaltyCoordination,
  FakeMembership,
  FakeNotification,
  FakePaymentReversal,
  FakeProductCatalog,
  FakePromo,
  FakeRecommendationCoordination,
  FakeReferralCoordination,
  FakeResellerDiscount,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  InMemoryOutboxRepository,
  buildCartService,
  buildTestConfig,
} from '../support/fakes';

/*
 * C3 — a voided sale owes nothing.
 *
 * The four completion effects are written into the outbox in the same transaction as the
 * status that earns them (H-10), which is what makes them survive an outage. A void
 * reverses the sale — restocks the goods, reverses the points, backs the owner's credit out
 * — but left those rows PENDING. Ten minutes later the sweep ran them against an order that
 * no longer exists as revenue: the stock just returned was consumed again, the points just
 * reversed were awarded again, and the franchise owner was credited again for money handed
 * back over the counter.
 *
 * The cause is not the claim (see the plan's B10 correction): `deliver()` re-reads the
 * order and only asks whether it still EXISTS, never what state it is in.
 */

const DEPOT = '11111111-1111-4111-8111-111111111111';

describe('a voided counter sale owes nothing (C3)', () => {
  let orders: InMemoryOrderRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let outbox: OutboxService;
  let inventory: FakeInventory;
  let loyalty: FakeLoyaltyCoordination;
  let franchiseRevenue: FakeFranchiseRevenue;
  let catalog: FakeProductCatalog;
  let service: OrderService;

  const operator: AuthenticatedUser = {
    sub: 'op-1',
    role: 'KEPALA_DEPOT' as never,
    phone: '08',
    depotId: DEPOT,
  };

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    outboxRepo = new InMemoryOutboxRepository();
    orders.outbox = outboxRepo;
    outbox = new OutboxService(outboxRepo, orders);
    const cart = new InMemoryCartRepository();
    catalog = new FakeProductCatalog();
    const depots = new FakeDepotDirectory();
    depots.owners.set(DEPOT, 'owner-1');
    inventory = new FakeInventory();
    loyalty = new FakeLoyaltyCoordination();
    franchiseRevenue = new FakeFranchiseRevenue();
    service = new OrderService(
      orders,
      cart,
      catalog,
      depots,
      new FakeDepotPricing(),
      loyalty,
      new FakeReferralCoordination(),
      new FakeMembership(),
      new FakeResellerDiscount(),
      new FakeCustomerDirectory(),
      new FakeNotification(),
      new FakePromo(),
      inventory,
      buildCartService(cart, catalog),
      buildTestConfig(),
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      franchiseRevenue,
      new FakeCashierShift(),
      new FakePaymentReversal(),
      outbox,
    );
  });

  /**
   * Sell over the counter with every completion effect failing, so the rows the sale owes
   * are still PENDING when the void lands — which is the whole window C3 is about. A sale
   * whose effects already landed is a different (and much rarer) problem.
   */
  const sellWithFailingEffects = async () => {
    inventory.consumeError = new Error('depot-service down');
    const product = catalog.seed({ id: randomUUID(), basePrice: 20000 });
    const order = await service.walkInSale(operator, {
      depotId: DEPOT,
      lines: [{ productId: product.id, quantity: 2 }],
      customerId: randomUUID(),
    });
    inventory.consumeError = null;
    // The fake repo runs its own clock, so "today" is pinned to the sale's own timestamp
    // — the void window is a calendar day and would otherwise be closed before it opened.
    return { order, now: new Date(order.createdAt.getTime() + 60 * 60 * 1000) };
  };

  it('cancels the rows the sale still owed rather than leaving them due', async () => {
    const { order, now } = await sellWithFailingEffects();
    expect(outboxRepo.rows.some((r) => r.status === 'PENDING')).toBe(true);

    await service.voidCounterSale(operator, order.id, 'Salah ukuran', now, 'Bearer t');

    const owed = outboxRepo.rows.filter((r) => r.status === 'PENDING');
    expect(owed).toHaveLength(0);
  });

  it('does not consume the stock it just handed back, ten minutes later', async () => {
    const { order, now } = await sellWithFailingEffects();
    await service.voidCounterSale(operator, order.id, 'Salah ukuran', now, 'Bearer t');
    const restocked = inventory.restockCalls.length;

    // The sweep, later. Nothing here is time-travel: the rows were due immediately.
    await outbox.processDue(new Date(now.getTime() + 10 * 60_000));

    expect(inventory.calls).toHaveLength(0);
    expect(inventory.restockCalls).toHaveLength(restocked);
  });

  it('does not award back the points it just reversed, or re-credit the owner', async () => {
    const { order, now } = await sellWithFailingEffects();
    await service.voidCounterSale(operator, order.id, 'Salah ukuran', now, 'Bearer t');
    // Against what stood BEFORE the sweep, not against zero: only the stock consume was
    // made to fail, so the other three effects legitimately landed at sale time. The
    // question is whether the sweep applies them a SECOND time.
    const awardsBefore = loyalty.calls.length;
    const postedBefore = franchiseRevenue.posted.length;

    await outbox.processDue(new Date(now.getTime() + 10 * 60_000));

    expect(loyalty.calls).toHaveLength(awardsBefore);
    expect(franchiseRevenue.posted).toHaveLength(postedBefore);
  });

  /*
   * The belt to the cancel's braces. A row already claimed by a sweep that was in flight
   * when the void landed cannot be cancelled — it is out of the table's hands by then — so
   * the handler itself refuses to apply a completion effect to an order that is no longer
   * completed.
   */
  it('refuses a row that escaped the cancel and reached the handler anyway', async () => {
    const { order, now } = await sellWithFailingEffects();
    await service.voidCounterSale(operator, order.id, 'Salah ukuran', now, 'Bearer t');

    const postedBefore = franchiseRevenue.posted.length;
    // A sweep already holding this row when the void landed cannot be called back — the
    // row is out of the table's hands by then. Put them all back as PENDING to stand for it.
    for (const row of outboxRepo.rows) {
      row.status = 'PENDING';
      row.nextAttemptAt = new Date(0);
    }
    await outbox.processDue(now);

    expect(inventory.calls).toHaveLength(0);
    expect(franchiseRevenue.posted).toHaveLength(postedBefore);
  });
});
