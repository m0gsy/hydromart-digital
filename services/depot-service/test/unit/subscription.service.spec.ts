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
  /** The depot the engine says serves the address; unset = an older engine that says nothing. */
  servingDepotId: string | undefined = undefined;
  calls: string[] = [];
  async create(input: unknown): Promise<{ id: string; servingDepotId?: string }> {
    if (this.error) throw this.error;
    this.lastInput = input;
    return { id: this.nextId, ...(this.servingDepotId ? { servingDepotId: this.servingDepotId } : {}) };
  }
  async pause(engineId: string): Promise<void> {
    if (this.error) throw this.error;
    this.calls.push(`pause:${engineId}`);
  }
  async resume(engineId: string): Promise<void> {
    if (this.error) throw this.error;
    this.calls.push(`resume:${engineId}`);
  }
  /** Where each engine plan delivers from now; absent = the engine does not know it. */
  serving: Record<string, string | null> = {};
  asked: string[][] = [];
  async servingDepots(ids: readonly string[]): Promise<Map<string, string | null>> {
    if (this.error) throw this.error;
    this.asked.push([...ids]);
    return new Map(ids.filter((id) => id in this.serving).map((id) => [id, this.serving[id] ?? null]));
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

  async listLinkedOpen(): Promise<Subscription[]> {
    return this.rows.filter(
      (r) =>
        r.orderSubscriptionId !== null &&
        (r.status === SubscriptionStatus.ACTIVE || r.status === SubscriptionStatus.PAUSED),
    );
  }

  async moveDepot(id: string, fromDepotId: string, toDepotId: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id && r.depotId === fromDepotId);
    if (!row) return false;
    row.depotId = toDepotId;
    return true;
  }
}

const UNKNOWN = '00000000-0000-0000-0000-000000000000';

describe('SubscriptionService', () => {
  let repo: InMemorySubscriptionRepository;
  let service: SubscriptionService;
  let engine: StubEngine;
  let depotId: string;
  let depotRepo: InMemoryDepotRepository;

  beforeEach(async () => {
    depotRepo = new InMemoryDepotRepository();
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

  // DEP-23: pause/resume used to flip only this row. The engine kept its own status, so a
  // plan the operator PAUSED still placed (and billed) deliveries every cycle.
  it('DEP-23: pause and resume reach the engine, with the engine id, before the row changes', async () => {
    const sub = await seed();
    await service.pause(sub.id);
    await service.resume(sub.id);
    expect(engine.calls).toEqual(['pause:eng-1', 'resume:eng-1']);
  });

  it('DEP-23: when the engine refuses, the depot row is NOT changed (fails closed)', async () => {
    const sub = await seed();
    engine.error = new Error('engine down');
    await expect(service.pause(sub.id)).rejects.toThrow('engine down');
    expect((await service.get(sub.id)).status).toBe(SubscriptionStatus.ACTIVE);

    engine.error = null;
    await service.pause(sub.id);
    engine.error = new Error('engine down');
    await expect(service.resume(sub.id)).rejects.toThrow('engine down');
    expect((await service.get(sub.id)).status).toBe(SubscriptionStatus.PAUSED);
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
      // The engine refuses a plan whose address another depot serves (D10, 2026-11-20).
      depotId,
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

  // Owner decision 2026-11-21: made for another depot's address, it belongs to that depot.
  it('records the plan under the depot that serves the address, not the one typing it in', async () => {
    const other = await new DepotService(depotRepo).create({
      code: 'BDG-01',
      name: 'Depot Bandung',
      ownershipType: OwnershipType.HKP,
      address: 'b',
      city: 'Bandung',
      province: 'Jabar',
      lat: -6.9,
      lng: 107.6,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    engine.servingDepotId = other.id;
    const sub = await seed();
    expect(sub.depotId).toBe(other.id);
    expect((engine.lastInput as { depotId: string }).depotId).toBe(depotId);
  });

  // The engine plan is already running: a depot this service does not know — or junk —
  // must not take (and fail) the row, or the plan is left with nothing to pause it from.
  it('keeps the row with the depot typing it in when the named depot is unknown or junk', async () => {
    for (const named of ['99999999-9999-4999-8999-999999999999', 'not-a-uuid']) {
      engine.servingDepotId = named;
      const sub = await seed();
      expect(sub.depotId).toBe(depotId);
    }
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

/*
 * Owner decision 2026-11-21: a depot-made plan is listed under the depot that delivers it. The
 * engine routes every plan by its pin on every run; the console row kept the depot stamped at
 * creation, so after a depot closed, moved or was redrawn the delivering depot could neither see
 * nor pause the plan.
 */
describe('SubscriptionService.rehome', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const GONE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  let repo: InMemorySubscriptionRepository;
  let engine: StubEngine;
  let service: SubscriptionService;
  const row = (
    id: string,
    depotId: string,
    engineId: string | null,
    status = SubscriptionStatus.ACTIVE,
  ) =>
    repo.rows.push({
      id,
      depotId,
      customerId: null,
      customerName: 'x',
      productLabel: 'Galon',
      productId: null,
      orderSubscriptionId: engineId,
      quantity: 1,
      cadence: SubscriptionCadence.WEEKLY,
      status,
      nextRunAt: null,
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  beforeEach(() => {
    repo = new InMemorySubscriptionRepository();
    engine = new StubEngine();
    const depots = { exists: async (id: string) => id === A || id === B };
    service = new SubscriptionService(repo, depots as never, engine as never);
  });

  it('moves a row to the depot its plan delivers from now, and only those that disagree', async () => {
    row('moves', A, 'e1');
    row('stays', A, 'e2');
    row('paused', A, 'e3', SubscriptionStatus.PAUSED); // resumes into B: listed there already
    row('unserved', A, 'e4'); // no depot serves it: stays where its failures are seen
    row('unknown-depot', A, 'e5'); // a depot this service does not know never takes a row
    row('cancelled', A, 'e6', SubscriptionStatus.CANCELLED);
    row('unlinked', A, null);
    engine.serving = { e1: B, e2: A, e3: B, e4: null, e5: GONE, e6: B };

    await expect(service.rehome()).resolves.toEqual({ checked: 5, moved: 2, ok: true });
    const at = (id: string) => repo.rows.find((r) => r.id === id)?.depotId;
    expect([at('moves'), at('stays'), at('paused'), at('unserved'), at('unknown-depot')]).toEqual([
      B,
      A,
      B,
      A,
      A,
    ]);
    expect([at('cancelled'), at('unlinked')]).toEqual([A, A]);
    // Cancelled and unlinked plans were never asked about.
    expect(engine.asked).toEqual([['e1', 'e2', 'e3', 'e4', 'e5']]);
  });

  it('asks in batches the engine accepts', async () => {
    for (let i = 0; i < 501; i += 1) row(`r${i}`, A, `e${i}`);
    await expect(service.rehome()).resolves.toMatchObject({ checked: 501, moved: 0, ok: true });
    expect(engine.asked.map((b) => b.length)).toEqual([500, 1]);
  });

  it('moves nothing and says so when the engine cannot answer', async () => {
    row('moves', A, 'e1');
    engine.serving = { e1: B };
    engine.error = new Error('order-service down');
    await expect(service.rehome()).resolves.toEqual({ checked: 0, moved: 0, ok: false });
    expect(repo.rows[0]?.depotId).toBe(A);
  });

  it('does not count a row somebody else moved in the meantime', async () => {
    row('raced', A, 'e1');
    engine.serving = { e1: B };
    repo.moveDepot = async () => false;
    await expect(service.rehome()).resolves.toEqual({ checked: 1, moved: 0, ok: true });
  });
});
