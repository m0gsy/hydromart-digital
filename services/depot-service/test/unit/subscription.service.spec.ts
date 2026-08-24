import { randomUUID } from 'node:crypto';

import { SubscriptionService } from '../../src/application/services/subscription.service';
import {
  Subscription,
  SubscriptionCadence,
  SubscriptionStatus,
} from '../../src/domain/subscription';
import {
  CadenceNotSupportedError,
  DepotNotFoundError,
  SubscriptionNotFoundError,
} from '../../src/domain/errors';
import {
  CreateSubscriptionData,
  SubscriptionRepository,
  UpdateSubscriptionData,
} from '../../src/application/ports/subscription.repository';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotService } from '../../src/application/services/depot.service';
import { InMemoryDepotRepository } from '../support/fakes';

/**
 * D10: the depot no longer keeps its own schedule — a plan is created on order-service's
 * engine and this row stands for it. The stub answers with an id, or throws the way the
 * real adapter does when the engine refuses.
 */
class StubEngine {
  lastInput: unknown = null;
  error: Error | null = null;
  nextId = 'eng-1';
  async create(input: unknown): Promise<string> {
    if (this.error) throw this.error;
    this.lastInput = input;
    return this.nextId;
  }
}

class InMemorySubscriptionRepository implements SubscriptionRepository {
  rows: Subscription[] = [];

  async create(data: CreateSubscriptionData): Promise<Subscription> {
    const now = new Date();
    const row: Subscription = {
      id: randomUUID(),
      status: SubscriptionStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.rows.push(row);
    return row;
  }

  async listForDepot(depotId: string, status?: SubscriptionStatus): Promise<Subscription[]> {
    return this.rows
      .filter((r) => r.depotId === depotId && (!status || r.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async networkActiveCounts(): Promise<{
    activeSubscriptions: number;
    activeSubscribers: number;
  }> {
    const active = this.rows.filter((r) => r.status === SubscriptionStatus.ACTIVE);
    return {
      activeSubscriptions: active.length,
      activeSubscribers: new Set(
        active.filter((r) => r.customerId !== null).map((r) => r.customerId as string),
      ).size,
    };
  }

  async activeCustomerIdsForDepot(depotId: string): Promise<string[]> {
    return [
      ...new Set(
        this.rows
          .filter(
            (r) =>
              r.depotId === depotId &&
              r.status === SubscriptionStatus.ACTIVE &&
              r.customerId !== null,
          )
          .map((r) => r.customerId as string),
      ),
    ];
  }

  async findById(id: string): Promise<Subscription | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async update(id: string, data: UpdateSubscriptionData): Promise<Subscription> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  }
}

const UNKNOWN = '00000000-0000-0000-0000-000000000000';

describe('SubscriptionService', () => {
  let repo: InMemorySubscriptionRepository;
  let service: SubscriptionService;
  let engine: StubEngine;
  let depotId: string;

  beforeEach(async () => {
    const depotRepo = new InMemoryDepotRepository();
    repo = new InMemorySubscriptionRepository();
    engine = new StubEngine();
    service = new SubscriptionService(repo, depotRepo, engine as never);
    const depot = await new DepotService(depotRepo).create({
      code: 'JKT-01',
      name: 'Depot Cikini',
      ownershipType: OwnershipType.HKP,
      address: 'a',
      city: 'Jakarta',
      province: 'DKI',
      lat: -6.19,
      lng: 106.84,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    depotId = depot.id;
  });

  const seed = () =>
    service.create({
      depotId,
      customerId: '11111111-1111-4111-8111-111111111111',
      customerName: 'Ibu Sari',
      productLabel: 'Galon 19L',
      productId: '22222222-2222-4222-8222-222222222222',
      quantity: 2,
      cadence: SubscriptionCadence.WEEKLY,
      firstDeliveryAt: new Date('2026-09-01T00:00:00Z'),
    });

  it('creates ACTIVE, then pause/resume toggles status', async () => {
    const sub = await seed();
    expect(sub.status).toBe(SubscriptionStatus.ACTIVE);

    const paused = await service.pause(sub.id);
    expect(paused.status).toBe(SubscriptionStatus.PAUSED);

    const resumed = await service.resume(sub.id);
    expect(resumed.status).toBe(SubscriptionStatus.ACTIVE);
  });

  /**
   * D10, the heart of it: the plan is created on the ENGINE first, and only then written
   * here. A depot row saved before the engine call would survive an engine refusal as
   * exactly the thing D10 removes — a plan the console shows and nothing runs.
   */
  it('writes no depot row when the engine refuses (D10)', async () => {
    engine.error = new Error('Pelanggan ini belum punya alamat tersimpan');
    await expect(seed()).rejects.toThrow(/alamat tersimpan/);
    expect(repo.rows).toHaveLength(0);
  });

  it('sends the engine what it needs, and records what it answered (D10)', async () => {
    const sub = await seed();
    expect(engine.lastInput).toEqual({
      customerId: '11111111-1111-4111-8111-111111111111',
      productId: '22222222-2222-4222-8222-222222222222',
      quantity: 2,
      frequency: 'WEEKLY',
      firstDeliveryAt: new Date('2026-09-01T00:00:00Z'),
    });
    expect(sub.orderSubscriptionId).toBe('eng-1');
    expect(sub.productId).toBe('22222222-2222-4222-8222-222222222222');
  });

  /**
   * The depot console offers DAILY and EVERY_3_DAYS; the engine has never had either. That
   * difference was invisible while nothing ran these plans at all — an operator could pick
   * "harian" and the system would simply never deliver, silently, forever. Refusing at
   * creation is the first moment anybody could have been told.
   */
  it('refuses a cadence the engine cannot run, instead of pretending (D10)', async () => {
    await expect(
      service.create({
        depotId,
        customerId: '11111111-1111-4111-8111-111111111111',
        customerName: 'Ibu Sari',
        productLabel: 'Galon 19L',
        productId: '22222222-2222-4222-8222-222222222222',
        quantity: 1,
        cadence: SubscriptionCadence.DAILY,
        firstDeliveryAt: new Date('2026-09-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(CadenceNotSupportedError);
    expect(repo.rows).toHaveLength(0);
    expect(engine.lastInput).toBeNull();
  });

  it('throws NotFound pausing, resuming or reading a missing subscription', async () => {
    await expect(service.pause(UNKNOWN)).rejects.toBeInstanceOf(SubscriptionNotFoundError);
    await expect(service.resume(UNKNOWN)).rejects.toBeInstanceOf(SubscriptionNotFoundError);
    await expect(service.get(UNKNOWN)).rejects.toBeInstanceOf(SubscriptionNotFoundError);
  });

  it('rejects creating or listing against an unknown depot', async () => {
    await expect(
      service.create({
        depotId: UNKNOWN,
        customerId: '11111111-1111-4111-8111-111111111111',
        customerName: 'Ibu Sari',
        productLabel: 'Galon 19L',
        productId: '22222222-2222-4222-8222-222222222222',
        quantity: 1,
        cadence: SubscriptionCadence.WEEKLY,
        firstDeliveryAt: new Date('2026-09-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
    await expect(service.list(UNKNOWN)).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('lists depot subscriptions, filters by status, and reads one by id', async () => {
    const a = await seed();
    const b = await seed();
    await service.pause(a.id);

    expect((await service.list(depotId)).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(
      (await service.list(depotId, { status: SubscriptionStatus.ACTIVE })).map((s) => s.id),
    ).toEqual([b.id]);
    expect((await service.get(a.id)).status).toBe(SubscriptionStatus.PAUSED);
  });

  it('keeps an explicit customerId, nextRunAt and note instead of the null defaults', async () => {
    const nextRunAt = new Date('2026-08-01T00:00:00.000Z');
    const sub = await service.create({
      depotId,
      customerId: '44444444-4444-4444-4444-444444444444',
      customerName: 'Pak Budi',
      productLabel: 'Galon 19L',
      productId: '22222222-2222-4222-8222-222222222222',
      quantity: 3,
      cadence: SubscriptionCadence.MONTHLY,
      firstDeliveryAt: nextRunAt,
      note: 'Titip pos satpam',
    });
    expect(sub.customerId).toBe('44444444-4444-4444-4444-444444444444');
    // D10: what the operator picks is the FIRST delivery, and the engine owns every date
    // after it. The row records where the schedule started, not a second schedule.
    expect(sub.nextRunAt).toEqual(nextRunAt);
    expect(sub.orderSubscriptionId).toBe('eng-1');
    expect(sub.note).toBe('Titip pos satpam');
  });
});

/*
 * S2. `isSubscriber` on the depot CRM card was a hardcoded null because most subscription
 * rows carried a free-text name and no `customerId`. This is the read that fixes it — and
 * it deliberately answers about LINKED rows only: a subscription nobody attached to an
 * account is not evidence that the person does not subscribe, which is why the create
 * route now insists on a real customer.
 */
describe('SubscriptionService.activeCustomerIds', () => {
  it('returns distinct linked customers with an ACTIVE subscription at this depot', async () => {
    const repo = new InMemorySubscriptionRepository();
    const depots = { exists: async () => true } as never;
    const service = new SubscriptionService(repo, depots, new StubEngine() as never);
    const base = {
      depotId: 'depot-a',
      customerName: 'x',
      productLabel: 'Galon 19L',
      productId: '22222222-2222-4222-8222-222222222222',
      quantity: 1,
      cadence: SubscriptionCadence.WEEKLY,
      firstDeliveryAt: new Date('2026-09-01T00:00:00Z'),
      note: null,
    };
    await service.create({ ...base, customerId: 'c1' });
    // Same customer twice → one id, not two.
    await service.create({ ...base, customerId: 'c1' });
    await service.create({ ...base, customerId: 'c2' });
    // D10 removed the unlinked case entirely: `customerId` is required now, because the
    // engine places orders for an account and not for a name. The row that used to be
    // created here could not exist.
    // Another depot's subscriber must not leak into this depot's directory.
    await service.create({ ...base, depotId: 'depot-b', customerId: 'c9' });
    // Paused: they are not currently subscribing.
    const paused = await service.create({ ...base, customerId: 'c3' });
    await service.pause(paused.id);

    const ids = await service.activeCustomerIds('depot-a');
    expect([...ids].sort()).toEqual(['c1', 'c2']);
  });

  it('returns an empty set for a depot with no linked subscribers', async () => {
    const service = new SubscriptionService(
      new InMemorySubscriptionRepository(),
      { exists: async () => true } as never,
      new StubEngine() as never,
    );
    await expect(service.activeCustomerIds('depot-a')).resolves.toEqual([]);
  });
});

/*
 * K1.11 · two subscription systems, one nav label, one number.
 *
 * HQ's /hq/subscriptions reads order-service's `subscriptions/admin/summary` — the
 * customer-created plans — and calls the result "langganan jaringan". Depot-created
 * subscriptions live in THIS service and are listed one depot at a time, so every one of
 * them is silently missing from the network figure. Nothing on that screen says so: the
 * number is not labelled "customer subscriptions", it is labelled as the total.
 *
 * A count that quietly excludes a whole population is worse than no count — an operator
 * reading it plans against it. This is the half that was never countable network-wide.
 */
describe('SubscriptionService.networkSummary', () => {
  const base = {
    customerName: 'x',
    productLabel: 'Galon 19L',
    productId: '22222222-2222-4222-8222-222222222222',
    quantity: 1,
    cadence: SubscriptionCadence.WEEKLY,
    firstDeliveryAt: new Date('2026-09-01T00:00:00Z'),
    note: null,
  };
  const build = () =>
    new SubscriptionService(
      new InMemorySubscriptionRepository(),
      { exists: async () => true } as never,
      new StubEngine() as never,
    );

  it('counts ACTIVE depot subscriptions across every depot, and their distinct subscribers', async () => {
    const service = build();
    await service.create({ ...base, depotId: 'depot-a', customerId: 'c1' });
    // Same person, second plan: two subscriptions, one subscriber.
    await service.create({ ...base, depotId: 'depot-a', customerId: 'c1' });
    await service.create({ ...base, depotId: 'depot-b', customerId: 'c2' });
    // Paused is not subscribing — the same rule `activeCustomerIds` already applies.
    const paused = await service.create({ ...base, depotId: 'depot-b', customerId: 'c3' });
    await service.pause(paused.id);

    await expect(service.networkSummary()).resolves.toEqual({
      activeSubscriptions: 3,
      activeSubscribers: 2,
    });
  });

  it('answers zero rather than throwing when no depot has any', async () => {
    await expect(build().networkSummary()).resolves.toEqual({
      activeSubscriptions: 0,
      activeSubscribers: 0,
    });
  });
});
