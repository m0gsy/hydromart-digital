import { randomUUID } from 'node:crypto';

import { OrderService } from '../../src/application/services/order.service';
import { SubscriptionService } from '../../src/application/services/subscription.service';
import {
  ProductUnavailableError,
  SubscriptionAddressNotRoutableError,
  SubscriptionCustomerAddressMissingError,
  SubscriptionNotActionableError,
  SubscriptionNotFoundError,
} from '../../src/domain/errors';
import { DeliveryAddressSnapshot } from '../../src/application/ports/order.repository';
import {
  FakeDepotDirectory,
  FakeDepotPricing,
  FakeForecastCoordination,
  FakeFranchiseRevenue,
  FakeGallonIssue,
  FakeCashierShift,
  FakePaymentReversal,
  FakeInventory,
  FakeLoyaltyCoordination,
  FakeMembership,
  FakeResellerDiscount,
  FakeCustomerDirectory,
  FakeNotification,
  FakeProductCatalog,
  FakePromo,
  FakeRecommendationCoordination,
  FakeReferralCoordination,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  InMemorySubscriptionRepository,
  buildCartService,
  buildOutbox,
  buildTestConfig,
} from '../support/fakes';

// Pinned: a scheduled run has nobody to ask for a depot, so an unpinned saved
// address is skipped by design (see 'skips a subscription that cannot be routed').
const address: DeliveryAddressSnapshot = {
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
  postalCode: '40111',
  latitude: -6.9,
  longitude: 107.6,
  notes: null,
};

const homeDepot = {
  id: 'depot-home',
  lat: -6.9,
  lng: 107.6,
  serviceRadiusKm: 10,
  deliveryFee: 5000,
  minOrderAmount: null,
};

describe('SubscriptionService', () => {
  let orders: InMemoryOrderRepository;
  let subs: InMemorySubscriptionRepository;
  let catalog: FakeProductCatalog;
  let orderService: OrderService;
  let service: SubscriptionService;
  let depots: FakeDepotDirectory;
  // D10: a depot-created subscription reads the customer's own primary address, so the spec
  // needs a handle on the directory to say whether they have one.
  let customers: FakeCustomerDirectory;
  // D9: the scheduled-order notification is sent AFTER the row exists and fails open, so
  // the spec needs a handle on it to make a send fail. D2 then reuses it the other way —
  // to see that the sweep TELLS the customer when it gives up on a plan.
  let notification: FakeNotification;
  const customer = randomUUID();

  beforeEach(() => {
    orders = new InMemoryOrderRepository();
    subs = new InMemorySubscriptionRepository();
    catalog = new FakeProductCatalog();
    depots = new FakeDepotDirectory();
    depots.depots = [homeDepot];
    customers = new FakeCustomerDirectory();
    const cart = new InMemoryCartRepository();
    const cartService = buildCartService(cart, catalog);
    notification = new FakeNotification();
    orderService = new OrderService(
      orders,
      cart,
      catalog,
      depots,
      new FakeDepotPricing(),
      new FakeLoyaltyCoordination(),
      new FakeReferralCoordination(),
      new FakeMembership(),
      new FakeResellerDiscount(),
      customers,
      notification,
      new FakePromo(),
      new FakeInventory(),
      cartService,
      buildTestConfig(),
      new FakeRecommendationCoordination(),
      new FakeForecastCoordination(),
      new FakeFranchiseRevenue(),
      new FakeGallonIssue(),
      new FakeCashierShift(),
      new FakePaymentReversal(),
      buildOutbox(orders),
    );
    service = new SubscriptionService(
      subs,
      catalog,
      orderService,
      buildTestConfig(),
      notification,
      customers,
    );
  });

  const seedProduct = () => catalog.seed({ id: randomUUID(), basePrice: 8000 });

  it('discountRate: quotes the depot ladder the sweep will actually charge', () => {
    // Same config the sweep prices against — the shop cannot quote a different saving.
    expect(service.discountRate(homeDepot.id)).toBe(0.05);
    expect(service.discountRate(null)).toBe(0.05);
  });

  it('creates an ACTIVE subscription snapshotting product name/unit', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 2,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
      address,
    });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.productName).toBe(p.name);
    expect(sub.quantity).toBe(2);
  });

  it('pauses, resumes and cancels; a cancelled sub can no longer be changed', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'MONTHLY',
      firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
      address,
    });
    expect((await service.pause(customer, sub.id)).status).toBe('PAUSED');
    expect((await service.resume(customer, sub.id, new Date())).status).toBe('ACTIVE');
    expect((await service.cancel(customer, sub.id)).status).toBe('CANCELLED');
    await expect(service.pause(customer, sub.id)).rejects.toBeInstanceOf(
      SubscriptionNotActionableError,
    );
    // resume is equally blocked once cancelled (BR: a cancelled sub is terminal).
    await expect(service.resume(customer, sub.id, new Date())).rejects.toBeInstanceOf(
      SubscriptionNotActionableError,
    );
  });

  // L0 REPRO (D4): pause never touches nextDeliveryAt, so the plan keeps its old due date
  // while it is asleep. Resume after six weeks and the very next sweep places a delivery
  // immediately — the customer paused their water and gets a gallon on the doorstep the
  // moment they come back.
  it('D4 REPRO: resuming after six weeks delivers immediately', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    await service.pause(customer, sub.id);

    const sixWeeksLater = new Date('2026-08-12T00:00:00Z');
    await service.resume(customer, sub.id, sixWeeksLater);

    // The next delivery must be in the FUTURE, not six weeks in the past.
    expect((await service.processDue(sixWeeksLater)).placed).toBe(0);
  });

  // The delivery DAY has to survive the pause too. Stepping the plan's own cadence keeps a
  // Tuesday plan on Tuesdays; adding one interval to the resume moment would move every
  // paused plan to whatever weekday the customer happened to press the button.
  it('keeps the delivery weekday across a pause (D4)', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-07T00:00:00Z'), // a Tuesday
      address,
    });
    await service.pause(customer, sub.id);

    // Resumed on a Thursday, six weeks on.
    const resumed = await service.resume(customer, sub.id, new Date('2026-08-13T09:00:00Z'));
    expect(resumed.nextDeliveryAt.toISOString()).toBe('2026-08-18T00:00:00.000Z');
    expect(resumed.nextDeliveryAt.getUTCDay()).toBe(2); // still Tuesday
  });

  // Resuming a plan that was never overdue must not push its date out — pausing for an
  // afternoon should not cost the customer a delivery.
  it('leaves a not-yet-due plan alone on resume (D4)', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-08-20T00:00:00Z'),
      address,
    });
    await service.pause(customer, sub.id);
    const resumed = await service.resume(customer, sub.id, new Date('2026-08-14T00:00:00Z'));
    expect(resumed.nextDeliveryAt.toISOString()).toBe('2026-08-20T00:00:00.000Z');
  });

  /**
   * D6 · the sweep is the only caller that knows which subscription a delivery belongs to,
   * so it is the only place the link can be recorded. Asserted on the stored row rather
   * than on the call, because a column nothing writes is the same as no column.
   *
   * The link existed before only as the idempotency string `sub:<id>:<iso>` — exposed on no
   * read model, queryable by nobody, and a naming convention D1 would otherwise have to
   * rest a money predicate on.
   */
  it('D6 · stamps the placed order with the subscription that produced it', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });

    await service.processDue(new Date('2026-07-13T00:00:00Z'));

    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0].subscriptionId).toBe(sub.id);
  });

  // L0 REPRO (D9): the ORDER_RECEIVED for a scheduled delivery is sent AFTER the order row
  // exists, and the notification port fails open — so a send that never lands leaves the
  // order placed, the customer uninformed, and nothing on the order saying so. The only
  // trace is a warning in a container log nobody reads.
  it('D9 REPRO: a scheduled order records nothing when the customer was never told', async () => {
    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    // How the real adapter reports an outage: it fails OPEN and answers `false`. Throwing
    // here would simulate an adapter that does not exist, and would test the sweep's
    // isolation instead of the silence this is about.
    notification.notify = async () => false;

    const out = await service.processDue(new Date('2026-07-02T00:00:00Z'));
    expect(out.placed).toBe(1);

    const placed = orders.rows[0]!;
    expect(orders.notes).toContainEqual(
      expect.objectContaining({
        id: placed.id,
        changedBy: 'order-service',
        note: expect.stringMatching(/tidak diberi tahu/i),
      }),
    );
  });

  // The other half, or "record the silence" becomes "record everything": a delivery whose
  // message DID land must carry no such note, or the note stops meaning anything.
  it('leaves no not-notified note when the message landed (D9)', async () => {
    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });

    expect((await service.processDue(new Date('2026-07-02T00:00:00Z'))).placed).toBe(1);
    expect(notification.calls.map((c) => c.event)).toContain('ORDER_RECEIVED');
    expect(orders.notes).toHaveLength(0);
  });

  /**
   * L0 REPRO (D2, calendar half): the sweep advances from NOW, not from the due date it
   * missed — `advanceDelivery(now, ...)`. So a plan that fails for three days and then
   * succeeds has its delivery day moved permanently: Tuesday becomes Friday and never
   * comes back. Verifikasi D asks for exactly this test.
   */
  it('D2 REPRO: a late delivery must not move the delivery day', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-07T00:00:00Z'), // a Tuesday
      address,
    });

    // The sweep only gets to it three days late.
    await service.processDue(new Date('2026-07-10T09:00:00Z')); // Friday

    const after = (await service.list(customer)).find((s) => s.id === sub.id)!;
    expect(after.nextDeliveryAt.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    expect(after.nextDeliveryAt.getUTCDay()).toBe(2); // still Tuesday
  });

  /**
   * D2, the failure half. The sweep used to write one warning and move on, so a plan whose
   * product had been pulled was retried on every tick for as long as it existed, and the
   * customer was never told their standing order had stopped arriving.
   */
  describe('D2 · a failing cycle is counted, explained, and eventually stopped', () => {
    const failingPlan = async () => {
      const p = seedProduct();
      const sub = await service.create(customer, {
        productId: p.id,
        quantity: 1,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
        address,
      });
      // The product is pulled from the catalogue after the plan was made — the exact
      // shape of a subscription that quietly stops being fulfillable.
      catalog.products.delete(p.id);
      return sub;
    };
    const tick = (n: number) => service.processDue(new Date(`2026-07-0${n}T00:00:00Z`));

    it('records the count and the reason, in words', async () => {
      const sub = await failingPlan();
      await tick(2);

      const after = (await service.list(customer)).find((s) => s.id === sub.id)!;
      expect(after.failureCount).toBe(1);
      expect(after.lastFailure).toBeTruthy();
      expect(after.lastFailureAt).not.toBeNull();
      // One blip is not a condition: still ACTIVE, still being tried.
      expect(after.status).toBe('ACTIVE');
    });

    it('pauses the plan and tells the customer once it stops being a blip', async () => {
      const sub = await failingPlan();
      await tick(2);
      await tick(3);
      await tick(4);

      const after = (await service.list(customer)).find((s) => s.id === sub.id)!;
      expect(after.failureCount).toBe(3);
      expect(after.status).toBe('PAUSED');
      expect(notification.calls.map((c) => c.event)).toContain('SUBSCRIPTION_PAUSED');
    });

    /**
     * The pause is the durable part; telling the customer is best-effort on top of it. A
     * notification port that throws must not escape here — this code runs INSIDE the
     * sweep's own catch, and an exception thrown from a catch block leaves the loop and
     * takes every remaining subscription in the batch with it.
     */
    it('still pauses when telling the customer throws', async () => {
      const sub = await failingPlan();
      notification.notify = async () => {
        throw new Error('crm down');
      };

      await tick(2);
      await tick(3);
      await expect(tick(4)).resolves.toEqual({ placed: 0, failed: 1, ok: false });

      const after = (await service.list(customer)).find((s) => s.id === sub.id)!;
      expect(after.status).toBe('PAUSED');
    });

    // Same reason, one level earlier: if the failure cannot even be RECORDED, the sweep
    // still has to finish the batch.
    it('survives a failure it cannot record', async () => {
      await failingPlan();
      subs.recordFailure = async () => {
        throw new Error('db down');
      };
      await expect(tick(2)).resolves.toEqual({ placed: 0, failed: 1, ok: false });
    });

    // The reason the count is CONSECUTIVE and not cumulative: a plan that failed once and
    // has delivered ever since is not in trouble, and must not be paused a year later by
    // arithmetic nobody remembers.
    it('clears the run as soon as one delivery lands', async () => {
      const p = seedProduct();
      const sub = await service.create(customer, {
        productId: p.id,
        quantity: 1,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
        address,
      });
      const pulled = catalog.products.get(p.id)!;
      catalog.products.delete(p.id);
      await tick(2);
      expect((await service.list(customer)).find((s) => s.id === sub.id)!.failureCount).toBe(1);

      catalog.products.set(p.id, pulled);
      await tick(3);

      const after = (await service.list(customer)).find((s) => s.id === sub.id)!;
      expect(after.failureCount).toBe(0);
      expect(after.lastFailure).toBeNull();
      expect(after.status).toBe('ACTIVE');
    });
  });

  it('processDue places an order for a due subscription and advances its schedule', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 3,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'), // already past
      address,
    });

    const now = new Date('2026-07-13T00:00:00Z');
    const result = await service.processDue(now);

    expect(result.placed).toBe(1);
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0].customerId).toBe(customer);
    // spec 7b: the routed depot's subscription discount applied (5% by default here).
    // subtotal = 8000 × 3 = 24000 → 1200 off.
    expect(orders.rows[0].discount).toBe(1200);
    // Inverted by D2, and this line was the bug written down as an expectation: "one week
    // past NOW" is exactly what moved the delivery day every time a cycle ran late. The
    // plan was due 1 July; the sweep only reached it on the 13th; the next delivery is the
    // next Tuesday on the plan's own cadence — 15 July — not a week after whenever the
    // sweep happened to run.
    const advanced = (await service.list(customer))[0].nextDeliveryAt;
    expect(advanced.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    expect(advanced.getTime()).toBeGreaterThan(now.getTime());
    // a paused subscription is not swept.
    await service.pause(customer, sub.id);
    expect((await service.processDue(new Date('2026-08-01T00:00:00Z'))).placed).toBe(0);
  });

  /*
   * J7 — a round that failed everything must not read like a round with nothing to do.
   *
   * The sweep catches per subscription so one bad plan cannot take the batch down, and
   * that is why `{ placed: 0 }` was the answer to both "nothing was due" and "every plan
   * threw". `scripts/scheduler/sweep.sh` saw HTTP 200 in both cases and refreshed the
   * heartbeat its container healthcheck reads, so the scheduler reported healthy while no
   * subscription order was being placed at all.
   */
  it('J7 · an idle round and a round that failed everything answer differently', async () => {
    const idle = await service.processDue(new Date('2026-07-13T00:00:00Z'));
    expect(idle).toEqual({ placed: 0, failed: 0, ok: true });

    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 3,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    jest.spyOn(orders, 'create').mockRejectedValue(new Error('depot-service unreachable'));

    const dead = await service.processDue(new Date('2026-07-13T00:00:00Z'));
    expect(dead).toEqual({ placed: 0, failed: 1, ok: false });
  });

  // The other half of the rule: losing one plan out of two is a working sweep. Reporting
  // that as a dead round would pin the scheduler to unhealthy for as long as the bad plan
  // exists, which hides the next real outage exactly as well as always-green does.
  it('J7 · a round that placed something stays ok even having lost a plan', async () => {
    const p = seedProduct();
    for (const q of [3, 4]) {
      await service.create(customer, {
        productId: p.id,
        quantity: q,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
        address,
      });
    }
    let calls = 0;
    const real = orders.create.bind(orders);
    jest.spyOn(orders, 'create').mockImplementation(async (...args: Parameters<typeof real>) => {
      calls += 1;
      if (calls === 1) throw new Error('depot-service unreachable');
      return real(...args);
    });

    const result = await service.processDue(new Date('2026-07-13T00:00:00Z'));
    expect(result).toEqual({ placed: 1, failed: 1, ok: true });
  });

  // H-3. The sweep read due rows, placed an order, then advanced the schedule. Two
  // sweeps overlapping — or an ops trigger fired twice — both saw the same row as due
  // and each placed a delivery the customer never ordered.
  it('places one delivery when two sweeps run over the same due subscription', async () => {
    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 3,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });

    const now = new Date('2026-07-13T00:00:00Z');
    const [a, b] = await Promise.all([service.processDue(now), service.processDue(now)]);

    expect(orders.rows).toHaveLength(1);
    // Counted by whoever moved the schedule on, so the ops report says one, not two.
    expect(a.placed + b.placed).toBe(1);
  });

  /**
   * The fixture is written straight to the repository now, because D3 refuses to CREATE an
   * unroutable plan through the service. The property is still worth guarding and it did
   * not go away with D3: rows like this exist in production from before the guard, and an
   * address can stop being routable later — a depot removed, a service radius redrawn.
   * What must never happen is the sweep placing a depot-less order or advancing past it.
   */
  it('skips a subscription whose address cannot be routed, leaving its schedule alone', async () => {
    const p = seedProduct();
    const sub = await subs.create({
      customerId: customer,
      productId: p.id,
      productName: p.name,
      unit: p.unit,
      quantity: 3,
      frequency: 'WEEKLY',
      nextDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      ...address,
      latitude: null,
      longitude: null,
    });

    const result = await service.processDue(new Date('2026-07-13T00:00:00Z'));

    // Placing a depot-less order would lose it silently; skipping keeps it due.
    expect(result.placed).toBe(0);
    expect(orders.rows).toHaveLength(0);
    const stillDue = (await service.list(customer)).find((s) => s.id === sub.id)!;
    expect(stillDue.nextDeliveryAt.getTime()).toBe(new Date('2026-07-01T00:00:00Z').getTime());
  });

  /**
   * L0 REPRO (D3): a subscription whose saved address has no map pin can never be routed.
   * `placeScheduled` calls `resolveDepot(address)` with no depot to fall back on, so it
   * throws `DepotRequiredError`, the sweep catches it and skips, and the schedule never
   * advances — a plan that is ACTIVE forever, delivers nothing, and says nothing.
   *
   * The customer set it up, sees "Aktif", and waits.
   */
  it('D3 REPRO: an unpinned address creates a subscription that can never deliver', async () => {
    const p = seedProduct();
    const unpinned = { ...address, latitude: null, longitude: null };

    await expect(
      service.create(customer, {
        productId: p.id,
        quantity: 1,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
        address: unpinned,
      }),
    ).rejects.toBeInstanceOf(SubscriptionAddressNotRoutableError);
  });

  /**
   * D10 · a subscription depot staff set up FOR a customer, on the same engine.
   *
   * The address is the CUSTOMER's own primary one, read here rather than taken from the
   * caller: a depot operator typing an address on somebody else's behalf is how the
   * unroutable plans D3 refuses got created in the first place.
   */
  describe('D10 · createForCustomer', () => {
    const input = {
      productId: '',
      quantity: 2,
      frequency: 'WEEKLY' as const,
      firstDeliveryAt: new Date('2026-09-01T00:00:00Z'),
    };

    it('delivers to the customer own primary address', async () => {
      const p = seedProduct();
      customers.primary = address;

      const sub = await service.createForCustomer(customer, { ...input, productId: p.id });

      expect(sub.customerId).toBe(customer);
      expect(sub.addressLine).toBe(address.addressLine);
      expect(sub.latitude).toBe(address.latitude);
    });

    // No address, no subscription. A standing instruction to send water somewhere cannot
    // be created against a guess, and the error names the missing thing so the operator
    // can ask the customer to add it.
    it('refuses when the customer has no saved address', async () => {
      const p = seedProduct();
      customers.primary = null;

      await expect(
        service.createForCustomer(customer, { ...input, productId: p.id }),
      ).rejects.toBeInstanceOf(SubscriptionCustomerAddressMissingError);
    });

    // D3 composes with it: an address that exists but has no map pin is refused too, by
    // the same guard every customer-made plan goes through.
    it('refuses an address with no map pin, through the D3 guard', async () => {
      const p = seedProduct();
      customers.primary = { ...address, latitude: null, longitude: null };

      await expect(
        service.createForCustomer(customer, { ...input, productId: p.id }),
      ).rejects.toBeInstanceOf(SubscriptionAddressNotRoutableError);
    });
  });

  it('refuses to subscribe to an inactive/unknown product', async () => {
    const inactive = catalog.seed({ id: randomUUID(), basePrice: 8000, active: false });
    await expect(
      service.create(customer, {
        productId: inactive.id,
        quantity: 1,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
        address,
      }),
    ).rejects.toBeInstanceOf(ProductUnavailableError);
    await expect(
      service.create(customer, {
        productId: randomUUID(),
        quantity: 1,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
        address,
      }),
    ).rejects.toBeInstanceOf(ProductUnavailableError);
  });

  it('404s when acting on a subscription the caller does not own', async () => {
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'MONTHLY',
      firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
      address,
    });
    await expect(service.pause(randomUUID(), sub.id)).rejects.toBeInstanceOf(
      SubscriptionNotFoundError,
    );
    await expect(service.cancel(customer, randomUUID())).rejects.toBeInstanceOf(
      SubscriptionNotFoundError,
    );
  });

  it('estimates monthly network delivery volume by cadence (18c)', async () => {
    const p = seedProduct();
    const mk = (frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY') =>
      service.create(customer, {
        productId: p.id,
        quantity: 1,
        frequency,
        firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
        address,
      });
    await mk('WEEKLY'); // 30/7 ≈ 4.286 deliveries/mo
    await mk('BIWEEKLY'); // 30/14 ≈ 2.143
    await mk('MONTHLY'); // 1

    const summary = await service.networkSummary();
    expect(summary.activeSubscriptions).toBe(3);
    expect(summary.activeSubscribers).toBe(1); // all one customer
    // rounded sum: 4.286 + 2.143 + 1 = 7.43 → 7
    expect(summary.estMonthlyDeliveries).toBe(7);
  });

  it('processDue isolates failures: a placement error skips that sub without advancing it', async () => {
    // Product exists at subscribe time but is later pulled → placeScheduled throws inside the sweep.
    const p = seedProduct();
    const sub = await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    catalog.throwOnGet = true; // pricing lookup now fails for this product

    const before = (await service.list(customer))[0].nextDeliveryAt.getTime();
    const result = await service.processDue(new Date('2026-07-13T00:00:00Z'));

    expect(result.placed).toBe(0);
    expect(orders.rows).toHaveLength(0);
    // schedule NOT advanced — the sub stays due for the next sweep.
    expect((await service.list(customer))[0].nextDeliveryAt.getTime()).toBe(before);
    expect(sub.status).toBe('ACTIVE');
  });

  it('logs a non-Error rejection without stopping the sweep', async () => {
    const p = seedProduct();
    await service.create(customer, {
      productId: p.id,
      quantity: 1,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-07-01T00:00:00Z'),
      address,
    });
    jest.spyOn(orders, 'create').mockRejectedValue('depot-service unreachable');

    await expect(service.processDue(new Date('2026-07-13T00:00:00Z'))).resolves.toEqual({
      placed: 0,
      failed: 1,
      ok: false,
    });
  });

  /**
   * K1.9. A plan was locked to whichever address was primary when it was made: no picker
   * at signup, no way to change it afterwards, and switching your primary address did not
   * move it. Somebody who moved house could only cancel and start again, losing the
   * schedule.
   */
  describe('changing the delivery address', () => {
    const moved: DeliveryAddressSnapshot = {
      recipientName: 'Budi',
      phone: '081234567890',
      addressLine: 'Jl. Asia Afrika 55',
      city: 'Bandung',
      province: 'Jawa Barat',
      postalCode: '40112',
      latitude: -6.92,
      longitude: 107.61,
      notes: 'pagar hijau',
    };

    const start = async () => {
      const p = seedProduct();
      return service.create(customer, {
        productId: p.id,
        quantity: 1,
        frequency: 'WEEKLY',
        firstDeliveryAt: new Date('2026-07-20T00:00:00Z'),
        address,
      });
    };

    it('moves the plan onto the new address', async () => {
      const sub = await start();

      const out = await service.changeAddress(customer, sub.id, moved);

      expect(out).toMatchObject({
        addressLine: 'Jl. Asia Afrika 55',
        latitude: -6.92,
        longitude: 107.61,
        notes: 'pagar hijau',
      });
    });

    it('leaves the schedule and the status exactly where they were', async () => {
      const sub = await start();

      const out = await service.changeAddress(customer, sub.id, moved);

      expect(out.nextDeliveryAt).toEqual(sub.nextDeliveryAt);
      expect(out.status).toBe(sub.status);
      expect(out.quantity).toBe(sub.quantity);
    });

    it('refuses somebody else plan', async () => {
      const sub = await start();

      await expect(service.changeAddress(randomUUID(), sub.id, moved)).rejects.toBeInstanceOf(
        SubscriptionNotFoundError,
      );
    });

    // Nothing will ever be delivered against a cancelled plan; letting its address change
    // would leave a dead row in the customer's list looking alive.
    it('refuses a cancelled plan', async () => {
      const sub = await start();
      await service.cancel(customer, sub.id);

      await expect(service.changeAddress(customer, sub.id, moved)).rejects.toBeInstanceOf(
        SubscriptionNotActionableError,
      );
    });
  });
});
